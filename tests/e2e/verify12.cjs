// 카세트 검증: 릴 크기와 회전을 화면에 그려진 결과로 잰다.
// usage: node verify12.cjs <distDir> <shotDir> <songFolder>
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')

const [dist, shots, songFolder] = process.argv.slice(2)
const FX = path.join(__dirname, '..', 'out', 'fixtures', 'vu')
const SONG = 'Oliver Tree - Life Goes On.flac'
const BASE = '/music-player/'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const HUB = 11, FULL = 25, TAPE = 47.6

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` (${detail})` : ''}`) }
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance
const mm = (v) => `${v.toFixed(2)}mm`
const packRadius = (remaining) => Math.sqrt(HUB ** 2 + (FULL ** 2 - HUB ** 2) * remaining)
const degPerSecond = (radius) => ((TAPE / radius) * 180) / Math.PI

const stub = () => {
  try {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('fx')
    FileSystemHandle.prototype.queryPermission = async function () { return 'granted' }
    const NativeAudio = window.Audio
    window.Audio = function (...a) { const el = new NativeAudio(...a); window.__audio = el; return el }
    window.__reads = { read: 0, unchanged: 0, unavailable: 0 }
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(...a) { super(...a); this.addEventListener('message', (e) => { window.__reads[e.data.kind] = (window.__reads[e.data.kind] ?? 0) + 1 }) }
    }
    window.__sources = 0
    const NativeContext = window.AudioContext
    window.AudioContext = class extends NativeContext {
      createMediaElementSource(el) { window.__sources += 1; return super.createMediaElementSource(el) }
    }
    window.__frames = 0
    const nativeRaf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (fn) => { window.__frames += 1; return nativeRaf(fn) }

    const centerOf = (rect) => [rect.left + rect.width / 2, rect.top + rect.height / 2]
    const hubs = () => [...document.querySelectorAll('[data-hub]')]
    window.__centers = () => hubs().map((h) => centerOf(h.parentElement.getBoundingClientRect()))
    // 릴 중심 사이 42.5mm를 자로 삼아 그려진 크기를 mm로 바꾼다
    window.__packs = () => {
      const [a, b] = window.__centers()
      const unit = Math.hypot(a[0] - b[0], a[1] - b[1]) / 42.5
      return [...document.querySelectorAll('[data-pack]')].map((c) => c.getBoundingClientRect().width / 2 / unit)
    }
    window.__markerAngles = () => {
      const centers = window.__centers()
      return hubs().map((h, i) => {
        const [x, y] = centerOf(h.querySelector('[data-marker]').getBoundingClientRect())
        return (Math.atan2(y - centers[i][1], x - centers[i][0]) * 180) / Math.PI
      })
    }
    // 화면 좌표라서 시계 방향이 양수다
    window.__reelSpeed = async (ms = 1200) => {
      let last = window.__markerAngles()
      const total = last.map(() => 0)
      const start = performance.now()
      while (performance.now() - start < ms) {
        await new Promise((r) => setTimeout(r, 30))
        const now = window.__markerAngles()
        now.forEach((v, i) => {
          let d = v - last[i]
          if (d < -180) d += 360
          if (d > 180) d -= 360
          total[i] += d
        })
        last = now
      }
      const seconds = (performance.now() - start) / 1000
      return total.map((v) => v / seconds)
    }
    // 감긴 테이프와 창의 대비비
    window.__tapeContrast = () => {
      const luminance = (element) => {
        const [r, g, b] = getComputedStyle(element).fill.match(/[\d.]+/g).map(Number).map((v) => {
          const c = v / 255
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const a = luminance(document.querySelector('[data-pack]'))
      const b = luminance(document.querySelector('[data-window]'))
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    }
    window.__progress = () => window.__audio.currentTime / window.__audio.duration
    window.__side = () => document.querySelector('[data-side]').textContent
  } catch {}
}

;(async () => {
  const files = [...fs.readdirSync(FX), SONG]
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    if (!url.startsWith(BASE)) { res.writeHead(404); return res.end() }
    const rel = url.slice(BASE.length) || 'index.html'
    const fx = rel.startsWith('__fx/') ? rel.slice(5) : null
    const file = fx === SONG ? path.join(songFolder, SONG) : fx ? path.join(FX, fx) : path.join(dist, rel)
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  fs.mkdirSync(shots, { recursive: true })
  await new Promise((r) => server.listen(4193, r))
  const browser = await chromium.launch({ channel: 'msedge' })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  await ctx.addInitScript(stub)
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) problems.push(`console: ${m.text()}`) })

  await page.goto(`http://localhost:4193${BASE}`, { waitUntil: 'networkidle' })

  const cassette = page.locator('[aria-label="카세트"]')
  const nowPlaying = async () => {
    await page.evaluate(() => { location.hash = '#/now-playing?tab=sound' })
    await page.getByRole('switch', { name: '원음 듣기' }).waitFor()
    await page.waitForTimeout(150)
  }
  const setting = async (name, label) => {
    await page.evaluate(() => { location.hash = '#/settings' })
    await page.locator(`input[name="${name}"]`).first().waitFor({ state: 'attached' })
    await page.locator(`label:has(input[name="${name}"])`, { hasText: new RegExp(`^${label}$`) }).click()
    await page.waitForTimeout(120)
  }
  const play = async (title) => {
    await page.evaluate(() => { location.hash = '#/folders' })
    await page.locator('main li', { hasText: 'fx' }).getByRole('link').click()
    await page.locator('main ol li').first().waitFor()
    await page.locator('main ol li', { hasText: title }).first().locator('button').first().click()
    await page.waitForFunction((t) => document.title.startsWith(`${t} - `) && !window.__audio.paused && window.__audio.currentTime > 0.1, title, { timeout: 8000 })
    await nowPlaying()
  }
  const packs = () => page.evaluate(() => window.__packs())
  const seekTo = async (ratio) => {
    await page.evaluate((r) => { window.__audio.currentTime = window.__audio.duration * r }, ratio)
    await page.waitForTimeout(700)
  }
  const progress = () => page.evaluate(() => window.__progress())
  const reelSpeed = (ms) => page.evaluate((v) => window.__reelSpeed(v), ms)

  // 곡이 없을 때
  await page.evaluate(() => { location.hash = '#/settings' })
  await page.locator('input[name="cover-view"]').first().waitFor({ state: 'attached' })
  check('기본은 앨범 표지', await page.locator('input[name="cover-view"][value="art"]').isChecked())
  await setting('cover-view', '카세트')
  await nowPlaying()
  check('표지 자리에 카세트', (await cassette.count()) === 1)
  const spot = await cassette.boundingBox()
  const body = await page.locator('[data-cassette]').boundingBox()
  check('데스크톱은 표지 자리가 정사각형', near(spot.width, spot.height, 2), `${Math.round(spot.width)}x${Math.round(spot.height)}`)
  check('데스크톱은 가로 카세트 비율', near(body.width / body.height, 1004 / 638, 0.02) && near(body.width, spot.width, 2), `${Math.round(body.width)}x${Math.round(body.height)}`)
  const [leftHub, rightHub] = await page.evaluate(() => window.__centers())
  check('데스크톱은 릴이 좌우로 놓임', near(leftHub[1], rightHub[1], 1) && leftHub[0] < rightHub[0])
  check('곡이 없으면 안내 문구', (await page.locator('[data-cell="title"]').innerText()) === '재생 중인 곡 없음')
  check('곡이 없으면 릴이 멈춤', (await reelSpeed(400)).every((v) => near(v, 0, 1)))

  await page.evaluate(async (list) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('fx', { create: true })
    for (const name of list) {
      const bytes = await (await fetch(`__fx/${encodeURIComponent(name)}`)).arrayBuffer()
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
      await w.write(bytes); await w.close()
    }
  }, files)
  await page.evaluate(() => { location.hash = '#/folders' })
  await page.getByRole('region', { name: '폴더' }).getByRole('button', { name: '폴더 추가' }).click()
  await page.waitForFunction((n) => window.__reads.read >= n, files.length, { timeout: 30000 })
  await page.waitForTimeout(500)

  // 면을 먼저 읽고 그에 맞게 판단한다
  const sideNow = () => page.evaluate(() => window.__side())
  const roles = (side) => ({ supply: side === 'A' ? 0 : 1, takeUp: side === 'A' ? 1 : 0, sign: side === 'A' ? -1 : 1 })

  await page.evaluate(() => { location.hash = '#/folders' })
  await page.locator('main li', { hasText: 'fx' }).getByRole('link').click()
  await page.locator('main ol li').first().waitFor()
  await page.locator('main ol li').first().locator('button').first().click()
  await page.waitForFunction(() => !window.__audio.paused && window.__audio.currentTime > 0.1, null, { timeout: 8000 })
  await nowPlaying()
  check('목록의 첫 곡은 A면', (await sideNow()) === 'A', await sideNow())
  await page.getByRole('button', { name: '다음 곡' }).click()
  await page.waitForTimeout(500)
  check('다음 곡은 B면', (await sideNow()) === 'B', await sideNow())

  await play('Life Goes On')
  check('카세트만 켜면 그래프를 만들지 않음', (await page.evaluate(() => window.__sources)) === 0)
  check('라벨에 곡 제목', (await page.locator('[data-cell="title"]').innerText()) === 'Life Goes On')
  const cell = (name) => page.locator(`[data-cell="${name}"]`).innerText()
  check('스티커 칸: 아티스트', (await cell('artist')) === 'Oliver Tree', await cell('artist'))
  check('스티커 칸: 코덱', (await cell('codec')) === 'FLAC', await cell('codec'))
  check('스티커 칸: 음질', (await cell('format')) === '44.1 kHz / 16 bit', await cell('format'))
  check('스티커 칸: 길이', (await cell('time')) === '2:41', await cell('time'))
  check('인쇄: 16bit 무손실은 TYPE II', (await page.locator('[data-type]').textContent()).startsWith('TYPE II '), await page.locator('[data-type]').textContent())
  check('인쇄: 코덱', (await page.locator('[data-codec]').textContent()) === 'FLAC')
  const lifeSide = await sideNow()
  const life = roles(lifeSide)
  console.log(`INFO Life Goes On은 ${lifeSide}면`)

  // 릴 크기
  const areas = []
  for (const ratio of [0.002, 0.25, 0.5, 0.75, 0.97]) {
    await seekTo(ratio)
    const value = await progress()
    const reels = await packs()
    const wantSupply = packRadius(1 - value), wantTakeUp = packRadius(value)
    areas.push(reels[0] ** 2 + reels[1] ** 2)
    check(`진행 ${Math.round(ratio * 100)}%: 릴 크기가 공식과 같음`, near(reels[life.supply], wantSupply, 0.3) && near(reels[life.takeUp], wantTakeUp, 0.3), `풀리는 쪽 ${mm(reels[life.supply])}/${mm(wantSupply)}, 감기는 쪽 ${mm(reels[life.takeUp])}/${mm(wantTakeUp)}`)
  }
  check('두 릴의 면적 합이 일정함', Math.max(...areas) - Math.min(...areas) < 12, areas.map((v) => v.toFixed(0)).join(', '))

  // 릴 회전
  await seekTo(0.75)
  await page.waitForTimeout(500)
  const lateReels = await packs()
  const lateSpeeds = await reelSpeed(1500)
  check(`${lifeSide}면: 릴 방향이 맞음`, lateSpeeds.every((v) => Math.sign(v) === life.sign), lateSpeeds.map((v) => v.toFixed(1)).join(', '))
  check('곡 뒤쪽: 풀리는 릴이 더 빨리 돎 (적게 감김)', Math.abs(lateSpeeds[life.supply]) > Math.abs(lateSpeeds[life.takeUp]) && lateReels[life.supply] < lateReels[life.takeUp], `풀리는 쪽 ${mm(lateReels[life.supply])} ${Math.abs(lateSpeeds[life.supply]).toFixed(1)}, 감기는 쪽 ${mm(lateReels[life.takeUp])} ${Math.abs(lateSpeeds[life.takeUp]).toFixed(1)}`)
  check('속도가 테이프 속도 공식과 같음', lateSpeeds.every((v, i) => near(Math.abs(v), degPerSecond(lateReels[i]), 6)), lateReels.map((r) => degPerSecond(r).toFixed(1)).join(', '))
  check('속도 비가 반지름 비와 같음', near(Math.abs(lateSpeeds[0] / lateSpeeds[1]), lateReels[1] / lateReels[0], 0.06), `${Math.abs(lateSpeeds[0] / lateSpeeds[1]).toFixed(3)}, ${(lateReels[1] / lateReels[0]).toFixed(3)}`)
  await seekTo(0.1)
  await page.waitForTimeout(500)
  const earlyReels = await packs()
  const earlySpeeds = await reelSpeed(1200)
  check('곡 앞쪽: 감기는 릴이 더 빨리 돎', Math.abs(earlySpeeds[life.takeUp]) > Math.abs(earlySpeeds[life.supply]) && near(Math.abs(earlySpeeds[life.takeUp]), degPerSecond(earlyReels[life.takeUp]), 7), `감기는 쪽 ${mm(earlyReels[life.takeUp])} ${Math.abs(earlySpeeds[life.takeUp]).toFixed(1)}, 풀리는 쪽 ${mm(earlyReels[life.supply])} ${Math.abs(earlySpeeds[life.supply]).toFixed(1)}`)
  const framesBefore = await page.evaluate(() => window.__frames)
  await page.waitForTimeout(1000)
  const frames = (await page.evaluate(() => window.__frames)) - framesBefore
  check('회전을 위해 매 프레임 그리지 않음', frames < 30, `1초에 ${frames}프레임`)

  const darkContrast = await page.evaluate(() => window.__tapeContrast())
  check('블랙: 테이프가 창과 구분됨', darkContrast >= 1.8, `대비 ${darkContrast.toFixed(2)}:1`)
  await page.screenshot({ path: path.join(shots, 'cassette-black.jpg'), type: 'jpeg', quality: 90 })

  // 관성과 탐색
  await page.getByRole('button', { name: '일시정지' }).click()
  await page.waitForTimeout(800)
  check('일시정지하면 릴이 멈춤', (await reelSpeed(400)).every((v) => near(v, 0, 1)))
  const held = await page.evaluate(() => window.__markerAngles())
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await page.waitForTimeout(30)
  const resumed = await page.evaluate(() => window.__markerAngles())
  const turn = (a, b) => { let d = Math.abs(a - b); if (d > 180) d = 360 - d; return d }
  check('다시 재생하면 멈춘 각도에서 이어 돎', held.every((v, i) => turn(v, resumed[i]) < 30), held.map((v, i) => turn(v, resumed[i]).toFixed(1)).join(', '))
  await page.waitForTimeout(800)
  const seekJump = await page.evaluate(async () => {
    const before = window.__markerAngles()
    window.__audio.currentTime = window.__audio.duration * 0.3
    await new Promise((r) => setTimeout(r, 120))
    const after = window.__markerAngles()
    return after.map((v, i) => { let d = v - before[i]; if (d < -180) d += 360; if (d > 180) d -= 360; return d })
  })
  check('탐색해도 릴이 튀지 않음', seekJump.every((d) => Math.sign(d) === life.sign && Math.abs(d) < 70), seekJump.map((d) => d.toFixed(1)).join(', '))

  // 오토리버스
  await seekTo(0.995)
  const endOfSide = await packs()
  await page.getByRole('button', { name: '다음 곡' }).click()
  await page.waitForFunction(() => !window.__audio.paused && window.__audio.currentTime > 0.1, null, { timeout: 8000 })
  await page.waitForTimeout(600)
  const startOfNext = await packs()
  const nextSide = await sideNow()
  const next = roles(nextSide)
  check('다음 곡은 면이 바뀜', nextSide !== lifeSide, `${lifeSide} -> ${nextSide}`)
  check('인쇄: 24bit 무손실은 TYPE IV', (await page.locator('[data-type]').textContent()).startsWith('TYPE IV '), await page.locator('[data-type]').textContent())
  check('면이 바뀌어도 릴 크기가 이어짐', near(endOfSide[0], startOfNext[0], 1) && near(endOfSide[1], startOfNext[1], 1), `${endOfSide.map(mm).join(', ')} -> ${startOfNext.map(mm).join(', ')}`)
  const nextSpeeds = await reelSpeed(1200)
  check(`${nextSide}면: 릴이 반대로 돎`, nextSpeeds.every((v) => Math.sign(v) === next.sign), nextSpeeds.map((v) => v.toFixed(1)).join(', '))
  check('면이 바뀐 뒤 적게 감긴 릴이 더 빨리 돎', Math.abs(nextSpeeds[next.takeUp]) > Math.abs(nextSpeeds[next.supply]), nextSpeeds.map((v) => v.toFixed(1)).join(', '))
  await seekTo(0.97)
  const lateNext = await packs()
  check('테이프가 반대쪽으로 돌아감', lateNext[next.takeUp] > lateNext[next.supply], lateNext.map(mm).join(', '))

  // 긴 제목
  const long = await page.evaluate(() => {
    const title = document.querySelector('[data-cell="title"]')
    const label = document.querySelector('[data-label]').getBoundingClientRect()
    title.textContent = '아주 긴 제목 '.repeat(20)
    const box = title.getBoundingClientRect()
    return { inside: box.right <= label.right + 1, cut: title.scrollWidth > title.clientWidth }
  })
  check('긴 제목은 라벨 안에서 줄임', long.inside && long.cut, JSON.stringify(long))
  await play('Life Goes On')

  // 움직임 줄이기
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(800)
  check('움직임 줄이기: 릴이 멈춤', (await reelSpeed(500)).every((v) => near(v, 0, 1)))
  await seekTo(0.75)
  const still = await packs()
  check('움직임 줄이기: 릴 크기는 진행을 보여 줌', near(still[life.takeUp], packRadius(await progress()), 0.4), still.map(mm).join(', '))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.waitForTimeout(900)
  check('설정을 풀면 다시 돎', (await reelSpeed(800)).every((v) => v * life.sign > 80))

  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForTimeout(250)
  const lightContrast = await page.evaluate(() => window.__tapeContrast())
  check('화이트: 테이프가 창과 구분됨', lightContrast >= 1.8, `대비 ${lightContrast.toFixed(2)}:1`)
  await page.screenshot({ path: path.join(shots, 'cassette-white.jpg'), type: 'jpeg', quality: 90 })
  await page.emulateMedia({ colorScheme: 'dark' })

  // 휴대폰 크기로 줄이면 세로
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  const tall = await page.locator('[data-cassette]').boundingBox()
  const stacked = await page.evaluate(() => window.__centers())
  check('좁은 화면은 세로 카세트', near(tall.width / tall.height, 638 / 1004, 0.02), `${Math.round(tall.width)}x${Math.round(tall.height)}`)
  check('눕히면 왼쪽 릴이 아래로 감', near(stacked[0][0], stacked[1][0], 1) && stacked[0][1] > stacked[1][1])
  const label = await page.locator('[data-cell="title"]').boundingBox()
  check('눕히면 글자도 같이 누움', label.height > label.width * 2, `${Math.round(label.width)}x${Math.round(label.height)}`)
  const sticker = await page.locator('[data-label]').boundingBox()
  const stickerLeft = sticker.x + sticker.width / 2 < tall.x + tall.width / 2
  check('눕히면 스티커가 왼쪽으로 감', stickerLeft && sticker.height > sticker.width, `${Math.round(sticker.width)}x${Math.round(sticker.height)}`)
  check('세로에서도 릴 크기가 맞음', near((await packs())[life.takeUp], packRadius(await progress()), 0.4))
  check('크기가 바뀌어도 계속 돎', (await reelSpeed(800)).every((v) => v * life.sign > 80))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(300)

  // 저장
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('switch', { name: '원음 듣기' }).waitFor()
  await page.waitForTimeout(300)
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('music-player:sound')))
  check('새로고침: 설정 유지', kept.coverView === 'cassette', kept.coverView)
  check('새로고침: 카세트 표시', (await cassette.count()) === 1)
  check('멈춘 상태로 복원되면 릴도 멈춤', (await reelSpeed(400)).every((v) => near(v, 0, 1)))
  await setting('cover-view', 'LP')
  await nowPlaying()
  check('LP로 전환', (await page.locator('[aria-label="LP"]').count()) === 1 && (await cassette.count()) === 0)
  await setting('cover-view', '앨범 표지')
  await nowPlaying()
  check('앨범 표지로 전환', (await cassette.count()) === 0)

  const real = problems.filter((p) => !p.includes('no supported source'))
  check('오류 없음', real.length === 0, real.slice(0, 4).join(' | '))
  await browser.close()
  server.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
