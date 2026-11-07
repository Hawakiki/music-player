// LP 뷰 검증: 회전 속도, 관성, 톤암 위치, 와우 주기, 움직임 줄이기, 실제 곡.
// usage: node verify11.cjs <distDir> <shotDir> <songFolder>
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')

const [dist, shots, songFolder] = process.argv.slice(2)
const FX = path.join(__dirname, '..', 'out', 'fixtures', 'vu')
const SONG = 'Oliver Tree - Life Goes On.flac'
const BASE = '/music-player/'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` (${detail})` : ''}`) }
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance
const deg = (v) => `${v.toFixed(1)}도/초`
const mm = (v) => `${v.toFixed(1)}mm`

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
      createMediaElementSource(el) { window.__sources += 1; window.__graph = this; return super.createMediaElementSource(el) }
    }
    window.__frames = 0
    const nativeRaf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (fn) => { window.__frames += 1; return nativeRaf(fn) }

    const connect = AudioNode.prototype.connect
    AudioNode.prototype.connect = function (target, ...rest) {
      if (target instanceof AudioDestinationNode) {
        const c = this.context
        if (!c.__out) { c.__out = c.createAnalyser(); c.__out.fftSize = 8192; c.__out.smoothingTimeConstant = 0 }
        connect.call(this, c.__out)
      }
      return connect.call(this, target, ...rest)
    }
    window.__angle = () => {
      const m = new DOMMatrix(getComputedStyle(document.querySelector('[data-disc]')).transform)
      return (Math.atan2(m.b, m.a) * 180) / Math.PI
    }
    window.__speed = async (ms = 1000) => {
      let total = 0, last = window.__angle()
      const start = performance.now()
      while (performance.now() - start < ms) {
        await new Promise((r) => setTimeout(r, 40))
        const now = window.__angle()
        let delta = now - last
        if (delta < -180) delta += 360
        if (delta > 180) delta -= 360
        total += delta
        last = now
      }
      return (total / (performance.now() - start)) * 1000
    }
    // 화면에 그려진 바늘 끝과 판 중심의 거리를 실제 mm로 바꾼다
    window.__stylus = () => {
      const disc = document.querySelector('[data-disc]')
      const plinth = disc.offsetParent.getBoundingClientRect()
      const x = plinth.left + disc.offsetLeft + disc.offsetWidth / 2
      const y = plinth.top + disc.offsetTop + disc.offsetHeight / 2
      const tip = document.querySelector('[data-stylus]').getBoundingClientRect()
      return (Math.hypot(tip.left + tip.width / 2 - x, tip.top + tip.height / 2 - y) / (disc.offsetWidth / 2)) * 150.8
    }
    window.__wow = async (ms) => {
      const m = window.__graph.__out, rate = window.__graph.sampleRate, a = new Float32Array(m.fftSize)
      const samples = []
      const start = performance.now()
      while (performance.now() - start < ms) {
        m.getFloatTimeDomainData(a)
        const crossings = []
        for (let i = 1; i < a.length; i++) if (a[i - 1] < 0 && a[i] >= 0) crossings.push(i - 1 + a[i - 1] / (a[i - 1] - a[i]))
        if (crossings.length > 3) samples.push([(performance.now() - start) / 1000, ((crossings.length - 1) * rate) / (crossings.at(-1) - crossings[0])])
        await new Promise((r) => setTimeout(r, 40))
      }
      const mean = samples.reduce((s, v) => s + v[1], 0) / samples.length
      let best = 0, bestPower = -1
      for (let f = 0.3; f <= 1.3; f += 0.005) {
        let re = 0, im = 0
        for (const [t, v] of samples) { re += (v - mean) * Math.cos(2 * Math.PI * f * t); im += (v - mean) * Math.sin(2 * Math.PI * f * t) }
        const power = re * re + im * im
        if (power > bestPower) { bestPower = power; best = f }
      }
      return best
    }
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
  await new Promise((r) => server.listen(4192, r))
  const browser = await chromium.launch({ channel: 'msedge' })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  await ctx.addInitScript(stub)
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) problems.push(`console: ${m.text()}`) })

  await page.goto(`http://localhost:4192${BASE}`, { waitUntil: 'networkidle' })

  const lp = page.locator('[aria-label="LP"]')
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
  const group = (name, label) => page.locator(`label:has(input[name="${name}"])`, { hasText: new RegExp(`^${label}$`) }).click()
  const speed = (ms) => page.evaluate((v) => window.__speed(v), ms)
  const stylus = () => page.evaluate(() => window.__stylus())
  const seekTo = async (ratio) => {
    await page.evaluate((r) => { window.__audio.currentTime = window.__audio.duration * r }, ratio)
    await page.waitForTimeout(1000)
  }

  // 곡이 없을 때
  await page.evaluate(() => { location.hash = '#/settings' })
  await page.locator('input[name="lp-speed"]').first().waitFor({ state: 'attached' })
  check('기본 표지일 때 회전 속도 비활성', await page.locator('input[name="lp-speed"]').first().isDisabled())
  check('회전 속도 기본값 33⅓', await page.locator('input[name="lp-speed"][value="33"]').isChecked())
  await setting('cover-view', 'LP')
  check('LP일 때 회전 속도 활성', await page.locator('input[name="lp-speed"]').first().isEnabled())
  await nowPlaying()
  check('표지 자리에 LP', (await lp.count()) === 1)
  const box = await lp.boundingBox()
  check('정사각형 표지 자리', near(box.width, box.height, 2), `${Math.round(box.width)}x${Math.round(box.height)}`)
  await page.waitForTimeout(700)
  const rest = await stylus()
  check('곡이 없으면 바늘이 판 밖에서 쉼', rest > 151, mm(rest))
  check('곡이 없으면 판이 멈춤', near(await speed(500), 0, 0.5))

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

  // 회전
  await play('Life Goes On')
  check('LP만 켜면 그래프를 만들지 않음', (await page.evaluate(() => window.__sources)) === 0)
  await page.waitForTimeout(1500)
  // 재생 중에 표지 자리를 드나들어도 바로 돌아야 한다
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => { location.hash = '#/settings' })
    await page.waitForTimeout(60 + i * 90)
    await nowPlaying()
    await page.waitForTimeout(1300)
    const again = await speed(600)
    check(`재생 중 다시 들어와도 돎 ${i + 1}`, near(again, 200, 10), deg(again))
  }
  const speed33 = await speed(2500)
  check('33⅓ rpm: 1.8초에 한 바퀴', near(speed33, 200, 6), deg(speed33))
  const framesBefore = await page.evaluate(() => window.__frames)
  await page.waitForTimeout(1000)
  const frames = (await page.evaluate(() => window.__frames)) - framesBefore
  check('회전을 위해 매 프레임 그리지 않음', frames < 15, `1초에 ${frames}프레임`)
  check('표지가 라벨로 보임', await page.evaluate(() => { const img = document.querySelector('[data-disc] img'); return !!img && img.naturalWidth > 0 }))
  await page.screenshot({ path: path.join(shots, 'lp-black.jpg'), type: 'jpeg', quality: 90 })

  // 관성과 이어 돌기
  await page.getByRole('button', { name: '일시정지' }).click()
  await page.waitForTimeout(120)
  const coasting = await speed(250)
  check('일시정지 직후 판이 서서히 멈춤', coasting > 5 && coasting < 190, deg(coasting))
  await page.waitForTimeout(1600)
  const stopped = await speed(500)
  check('곧 완전히 멈춤', near(stopped, 0, 0.5), deg(stopped))
  const held = await page.evaluate(() => window.__angle())
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await page.waitForTimeout(40)
  const resumed = await page.evaluate(() => window.__angle())
  let jump = Math.abs(resumed - held)
  if (jump > 180) jump = 360 - jump
  check('다시 재생하면 멈춘 각도에서 이어 돎', jump < 40, `${jump.toFixed(1)}도`)
  await page.waitForTimeout(1500)
  check('속도가 다시 돌아옴', near(await speed(1500), 200, 6))

  // 탐색해도 판이 튀지 않음
  const before = await page.evaluate(async () => {
    const a = window.__angle(), t = performance.now()
    window.__audio.currentTime = window.__audio.duration * 0.6
    await new Promise((r) => setTimeout(r, 300))
    let delta = window.__angle() - a
    if (delta < -180) delta += 360
    if (delta > 180) delta -= 360
    return { delta, ms: performance.now() - t }
  })
  const expected = (200 * before.ms) / 1000
  check('탐색해도 판이 튀지 않음', near(before.delta, expected, 20), `${before.delta.toFixed(1)}도, 예상 ${expected.toFixed(1)}도`)

  // 톤암
  await seekTo(0.001)
  const outer = await stylus()
  check('시작: 바깥 홈 146mm', near(outer, 146, 1.5), mm(outer))
  await seekTo(0.5)
  const middle = await stylus()
  check('절반: 103mm', near(middle, 103, 2), mm(middle))
  await seekTo(0.98)
  const inner = await stylus()
  check('끝: 안쪽 홈 약 62mm', near(inner, 61.7, 2), mm(inner))
  check('바늘이 라벨을 건드리지 않음', inner > 50, mm(inner))
  await seekTo(0.25)
  const quarter = await stylus()
  check('진행률에 비례해서 움직임', near(quarter, 124.5, 2), mm(quarter))

  // 45 rpm
  await setting('lp-speed', '45')
  await nowPlaying()
  await page.waitForTimeout(1500)
  const speed45 = await speed(2500)
  check('45 rpm: 1.33초에 한 바퀴', near(speed45, 270, 8), deg(speed45))
  const timing = await page.evaluate(() => document.querySelector('[data-disc]').getAnimations()[0].currentTime)
  check('회전 시간이 음수가 아님', timing >= 0, timing.toFixed(0))

  // 와우 주기
  await play('기준 사인')
  await group('vinyl', '강')
  await page.waitForTimeout(600)
  const wow45 = await page.evaluate(() => window.__wow(7500))
  check('45 rpm 와우 주기 0.75Hz', near(wow45, 0.75, 0.07), `${wow45.toFixed(3)}Hz`)
  await setting('lp-speed', '33⅓')
  await nowPlaying()
  await page.waitForTimeout(500)
  const wow33 = await page.evaluate(() => window.__wow(7500))
  check('33⅓ rpm 와우 주기 0.556Hz', near(wow33, 0.556, 0.07), `${wow33.toFixed(3)}Hz`)
  await page.getByRole('button', { name: '초기화' }).click()
  check('초기화해도 LP 유지', (await lp.count()) === 1)

  // 움직임 줄이기
  await play('Life Goes On')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(1800)
  const still = await speed(800)
  check('움직임 줄이기: 판이 멈춤', near(still, 0, 0.5), deg(still))
  await seekTo(0.5)
  check('움직임 줄이기: 톤암은 진행을 보여 줌', near(await stylus(), 103, 2.5), mm(await stylus()))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.waitForTimeout(1500)
  check('설정을 풀면 다시 돎', near(await speed(1200), 200, 8))

  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(shots, 'lp-white.jpg'), type: 'jpeg', quality: 90 })
  await page.emulateMedia({ colorScheme: 'dark' })

  // 저장과 전환
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('switch', { name: '원음 듣기' }).waitFor()
  await page.waitForTimeout(300)
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('music-player:sound')))
  check('새로고침: 설정 유지', kept.coverView === 'lp' && kept.lpSpeed === '33', `${kept.coverView}, ${kept.lpSpeed}`)
  check('새로고침: LP 표시', (await lp.count()) === 1)
  check('멈춘 상태로 복원되면 판도 멈춤', near(await speed(500), 0, 0.5))
  await setting('cover-view', 'VU 미터')
  await nowPlaying()
  check('LP에서 VU로 전환', (await page.locator('[aria-label="VU 미터"]').count()) === 1 && (await lp.count()) === 0)
  await setting('cover-view', '앨범 표지')
  await nowPlaying()
  check('앨범 표지로 전환', (await lp.count()) === 0)
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('music-player:sound'))
    localStorage.setItem('music-player:sound', JSON.stringify({ ...saved, coverView: 'lp', lpSpeed: '78' }))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.evaluate(() => { location.hash = '#/settings' })
  await page.locator('input[name="lp-speed"]').first().waitFor({ state: 'attached' })
  check('저장값이 이상하면 33⅓', await page.locator('input[name="lp-speed"][value="33"]').isChecked())

  const real = problems.filter((p) => !p.includes('no supported source'))
  check('오류 없음', real.length === 0, real.slice(0, 4).join(' | '))
  await browser.close()
  server.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
