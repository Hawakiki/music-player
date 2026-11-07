// 5단계 검증: 소리 측정으로 EQ를, 진짜 파일로 파형과 표지를, 파일 왕복으로 재생목록을 본다.
// usage: node verify5.cjs <distDir> <shotDir>
const { spawnSync } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')

const [dist, shots] = process.argv.slice(2)
const FX = path.join(__dirname, '..', 'out', 'fixtures')
const BASE = '/music-player/'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' }
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  if (!url.startsWith(BASE)) { res.writeHead(404); return res.end() }
  const rel = url.slice(BASE.length) || 'index.html'
  if (rel === '__blank') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>blank</title>') }
  const file = rel.startsWith('__fx/') ? path.join(FX, rel.slice(5)) : path.join(dist, rel)
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` (${detail})` : ''}`) }
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance

// 측정용 1kHz 사인파
const tone = path.join(FX, 'tone-1k.flac')
if (!fs.existsSync(tone)) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=60:sample_rate=48000', '-af', 'volume=0.1', '-c:a', 'flac', '-metadata', 'title=측정음', '-metadata', 'artist=측정', '-metadata', 'album=측정 앨범', tone], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
}

const stub = () => {
  try {
    window.showDirectoryPicker = async () => {
      let dir = await navigator.storage.getDirectory()
      for (const part of localStorage.getItem('t:pick').split('/')) dir = await dir.getDirectoryHandle(part)
      return dir
    }
    FileSystemHandle.prototype.queryPermission = async function () { return 'granted' }
    const NativeAudio = window.Audio
    window.Audio = function (...args) { const el = new NativeAudio(...args); window.__audio = el; return el }
    window.__sources = 0
    window.__decodes = 0
    const NativeContext = window.AudioContext
    window.AudioContext = class extends NativeContext {
      createMediaElementSource(el) { window.__sources += 1; window.__graph = this; return super.createMediaElementSource(el) }
    }
    const NativeOffline = window.OfflineAudioContext
    window.OfflineAudioContext = class extends NativeOffline {
      decodeAudioData(...args) { window.__decodes += 1; return super.decodeAudioData(...args) }
    }
    // 최종 출력 앞에 측정 노드를 끼운다
    const connect = AudioNode.prototype.connect
    AudioNode.prototype.connect = function (target, ...rest) {
      if (target instanceof AudioDestinationNode) {
        this.context.__meter ??= this.context.createAnalyser()
        this.context.__meter.fftSize = 2048
        connect.call(this, this.context.__meter)
      }
      return connect.call(this, target, ...rest)
    }
    const disconnect = AudioNode.prototype.disconnect
    AudioNode.prototype.disconnect = function (...args) { return disconnect.apply(this, args) }
    window.__level = async () => {
      const meter = window.__graph?.__meter
      if (!meter) return 0
      const data = new Float32Array(2048)
      let total = 0
      for (let i = 0; i < 12; i++) {
        meter.getFloatTimeDomainData(data)
        total += Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length)
        await new Promise((r) => setTimeout(r, 40))
      }
      return total / 12
    }
  } catch {}
}

const install = (page, files, folder = 'library') => page.evaluate(async ([list, name]) => {
  const root = await navigator.storage.getDirectory()
  const lib = await root.getDirectoryHandle(name, { create: true })
  for (const [rel, src] of list) {
    const parts = rel.split('/'), file = parts.pop()
    let dir = lib
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true })
    const bytes = await (await fetch(`__fx/${src.split('/').map(encodeURIComponent).join('/')}`)).arrayBuffer()
    const w = await (await dir.getFileHandle(file, { create: true })).createWritable()
    await w.write(bytes); await w.close()
  }
}, [files, folder])

;(async () => {
  fs.mkdirSync(shots, { recursive: true })
  const manifest = JSON.parse(fs.readFileSync(path.join(FX, 'manifest.json'), 'utf8'))
  await new Promise((r) => server.listen(4178, r))
  const url = `http://localhost:4178${BASE}`
  const browser = await chromium.launch({ channel: 'msedge' })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', acceptDownloads: true })
  await ctx.addInitScript(stub)
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) problems.push(`console: ${m.text()}`) })

  const dbInfo = () => page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('music-player')
    r.onsuccess = () => {
      const db = r.result, names = [...db.objectStoreNames], out = { version: db.version }
      const tx = db.transaction(names)
      let left = names.length
      for (const n of names) { const q = tx.objectStore(n).count(); q.onsuccess = () => { out[n] = q.result; if (--left === 0) { db.close(); res(out) } } }
    }
  }))
  const level = () => page.evaluate(() => window.__level())
  const bar = () => page.getByRole('region', { name: '플레이어' })
  const main = () => page.locator('main')
  const side = () => page.getByRole('region', { name: '폴더' })
  const nav = (name) => page.getByRole('navigation', { name: '라이브러리' }).getByRole('link', { name, exact: true }).click()
  const tile = (name) => page.locator('main a[href*="#/albums/"]', { hasText: name }).first()
  const openAlbum = async (name) => { await nav('앨범'); await tile(name).click(); await page.getByRole('heading', { name, level: 1 }).waitFor() }
  const row = (name) => main().locator('ol li', { hasText: name })
  const menu = async (name) => { await row(name).getByRole('button', { name: /더 보기/ }).click({ force: true }) }
  const item = (name) => page.getByRole('menuitem', { name, exact: true })
  const notice = () => page.getByRole('status').innerText()
  const enterPlayer = async (tab) => {
    await (tab === 'eq' ? bar().getByRole('link', { name: '이퀄라이저' }) : bar().getByRole('link', { name: '전체 화면으로 보기' })).click()
    await page.getByRole('navigation', { name: '화면' }).waitFor()
  }
  const slider = (name) => page.getByRole('slider', { name, exact: true })
  const setSlider = async (name, steps, key) => { await slider(name).focus(); for (let i = 0; i < steps; i++) await page.keyboard.press(key) }

  // 저장소 v2에서 v3로 올리기
  await page.goto(`${url}__blank`)
  await install(page, [...manifest.map((f) => [f, `lib/${f}`]), ['측정/1kHz.flac', 'tone-1k.flac']])
  await page.evaluate(async () => {
    const handle = await (await navigator.storage.getDirectory()).getDirectoryHandle('library')
    await new Promise((res, rej) => {
      const r = indexedDB.open('music-player', 2)
      r.onupgradeneeded = () => {
        const db = r.result
        db.createObjectStore('folders', { keyPath: 'id' })
        db.createObjectStore('tracks', { keyPath: 'id' }).createIndex('folderId', 'folderId')
        db.createObjectStore('art')
        db.createObjectStore('favorites', { keyPath: 'id' }).createIndex('folderId', 'folderId')
      }
      r.onerror = rej
      r.onsuccess = () => {
        const tx = r.result.transaction('folders', 'readwrite')
        tx.objectStore('folders').put({ id: 'legacy', name: 'library', handle, addedAt: 1 })
        tx.oncomplete = () => { r.result.close(); res() }
      }
    })
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  await tile('유리 온실').waitFor({ timeout: 15000 })
  await tile('측정 앨범').waitFor({ timeout: 15000 })
  const up = await dbInfo()
  check('저장소 v2에서 v3로 업그레이드, 폴더 유지', up.version === 3 && up.folders === 1 && up.waves === 0 && up.playlists === 0, JSON.stringify(up))

  // EQ: 끈 상태에서는 그래프가 없어야 한다
  await openAlbum('측정 앨범')
  await row('측정음').locator('button').first().click()
  await page.waitForFunction(() => !window.__audio.paused && window.__audio.currentTime > 0.2, null, { timeout: 5000 })
  check('EQ를 안 쓰면 Web Audio를 거치지 않음', await page.evaluate(() => window.__sources) === 0)

  await enterPlayer('eq')
  check('이퀄라이저 버튼으로 EQ 탭이 열림', await page.getByRole('switch', { name: '이퀄라이저 사용' }).isVisible() && page.url().includes('tab=eq'), page.url())
  await page.getByRole('switch', { name: '이퀄라이저 사용' }).click()
  await page.waitForTimeout(400)
  check('EQ를 켜면 그래프 연결', await page.evaluate(() => window.__sources === 1 && window.__graph.state === 'running'), await page.evaluate(() => window.__graph?.state))
  check('재생이 끊기지 않음', await page.evaluate(() => !window.__audio.paused))
  const flat = await level()
  check('EQ를 켜도 소리가 나옴 (평탄, 사인파 0.0125의 RMS)', near(flat, 0.00884, 0.001), flat.toFixed(4))

  // 소리 측정
  await setSlider('1kHz', 24, 'ArrowUp')
  await page.waitForTimeout(400)
  const boosted = await level()
  check('1kHz +12dB면 1kHz 소리가 약 4배', near(boosted / flat, 3.98, 0.5), `x${(boosted / flat).toFixed(2)}`)
  check('값 표시', (await page.locator('aside').innerText()).includes('+12.0'))
  check('손으로 바꾸면 직접 조정', await page.getByRole('combobox', { name: '프리셋' }).inputValue() === '')
  await setSlider('프리앰프', 12, 'ArrowDown')
  await page.waitForTimeout(400)
  const reduced = await level()
  check('프리앰프 -6dB면 절반', near(reduced / boosted, 0.5, 0.08), `x${(reduced / boosted).toFixed(2)}`)
  await setSlider('8kHz', 24, 'ArrowUp')
  await page.waitForTimeout(400)
  const other = await level()
  check('다른 대역(8kHz)은 1kHz에 영향 없음', near(other / reduced, 1, 0.1), `x${(other / reduced).toFixed(2)}`)

  await page.getByRole('switch', { name: '이퀄라이저 사용' }).click()
  await page.waitForTimeout(400)
  const bypass = await level()
  check('끄면 원음으로', near(bypass / flat, 1, 0.08), `x${(bypass / flat).toFixed(2)}`)
  await page.getByRole('switch', { name: '이퀄라이저 사용' }).click()
  await page.waitForTimeout(400)
  check('다시 켜면 설정 복귀', near((await level()) / reduced, 1, 0.12))

  await page.getByRole('slider', { name: '볼륨' }).focus()
  for (let i = 0; i < 50; i++) await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(300)
  const afterVolume = await level()
  check('EQ를 켜도 볼륨이 적용', afterVolume < reduced * 0.75, `x${(afterVolume / reduced).toFixed(2)}, volume ${await page.evaluate(() => window.__audio.volume)}`)
  await page.getByRole('slider', { name: '볼륨' }).focus()
  for (let i = 0; i < 50; i++) await page.keyboard.press('ArrowRight')

  // 프리셋
  const preset = page.getByRole('combobox', { name: '프리셋' })
  await preset.selectOption({ label: '저음 강조' })
  await page.waitForTimeout(150)
  check('프리셋 적용', (await page.locator('aside').innerText()).includes('+6.0'))
  await page.getByRole('button', { name: '저장' }).click()
  await page.getByRole('textbox', { name: '이름' }).fill('내 설정')
  await page.getByRole('dialog').getByRole('button', { name: '저장' }).click()
  await page.waitForTimeout(150)
  check('프리셋 저장', (await preset.innerText()).includes('내 설정'))
  await page.getByRole('button', { name: '초기화' }).click()
  await page.waitForTimeout(150)
  check('초기화', !(await page.locator('aside').innerText()).includes('+6.0'))
  await preset.selectOption({ label: '내 설정' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('switch', { name: '이퀄라이저 사용' }).waitFor()
  await page.waitForTimeout(500)
  check('새로고침: EQ 설정 유지', await page.getByRole('switch', { name: '이퀄라이저 사용' }).getAttribute('aria-checked') === 'true' && (await page.getByRole('combobox', { name: '프리셋' }).locator('option:checked').innerText()) === '내 설정')
  check('새로고침: 재생 전에는 그래프를 만들지 않음', await page.evaluate(() => window.__sources) === 0)
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await page.waitForFunction(() => !window.__audio.paused && window.__audio.currentTime > 0.1, null, { timeout: 5000 })
  await page.waitForTimeout(400)
  const resumed = await page.evaluate(() => ({ sources: window.__sources, state: window.__graph?.state }))
  check('재생을 누르면 그래프 연결', resumed.sources === 1 && resumed.state === 'running', JSON.stringify(resumed))
  check('소리가 나옴', (await level()) > 0.003)
  await page.getByRole('button', { name: '프리셋 삭제' }).click()
  await page.waitForTimeout(100)
  check('프리셋 삭제', !(await page.getByRole('combobox', { name: '프리셋' }).innerText()).includes('내 설정'))
  await page.getByRole('combobox', { name: '프리셋' }).selectOption({ label: '평탄' })
  await page.getByRole('switch', { name: '이퀄라이저 사용' }).click()
  await page.evaluate(() => window.__audio.pause())

  // 전체 화면: 표지, 파형
  await page.getByRole('link', { name: '라이브러리' }).click()
  await page.getByRole('heading', { name: '측정 앨범', level: 1 }).waitFor()
  check('라이브러리 버튼은 보던 화면으로 돌아감', page.url().includes('#/albums/'), page.url())
  await openAlbum('유리 온실')
  await row('새벽 버스').locator('button').first().click()
  await enterPlayer()
  const bigCover = page.locator('main img').first()
  const coverOk = await page.waitForFunction(() => document.querySelector('main img')?.naturalWidth === 600, null, { timeout: 5000 }).then(() => true, () => false)
  check('전체 화면은 원본 표지 (썸네일 384가 아닌 600)', coverOk, String(await bigCover.evaluate((i) => i.naturalWidth)))
  const heroText = (await main().innerText()).replace(/\s+/g, ' ')
  check('곡 정보 표시', heroText.includes('새벽 버스') && heroText.includes('밤의 정류장') && heroText.includes('유리 온실, 2023') && heroText.includes('FLAC 96 kHz / 24 bit'), heroText.slice(0, 140))
  check('다음 곡 표시', heroText.includes('다음 곡') && heroText.includes('돌아오는 길'))
  const wave = page.getByTestId('wave')
  check('파형 표시', await page.waitForFunction(() => document.querySelector('[data-testid=wave]')?.dataset.ready === 'true', null, { timeout: 8000 }).then(() => true, () => false))
  const decodes = await page.evaluate(() => window.__decodes)
  check('파형은 낮은 샘플레이트로 한 번만 풀음', decodes === 1, String(decodes))
  await page.waitForTimeout(150)
  const wavesCount = (await dbInfo()).waves
  check('파형 저장', wavesCount >= 1, String(wavesCount))
  await page.evaluate(() => { window.__audio.pause() })
  const box = await wave.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(200)
  check('파형을 누르면 그 위치로 이동', near(await page.evaluate(() => window.__audio.currentTime), 1, 0.2), String(await page.evaluate(() => window.__audio.currentTime)))
  await page.screenshot({ path: path.join(shots, 'now-playing-black.jpg'), type: 'jpeg', quality: 88 })

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.querySelector('[data-testid=wave]')?.dataset.ready === 'true', null, { timeout: 8000 })
  check('다시 열면 파형을 캐시에서 읽음', await page.evaluate(() => window.__decodes) === 0)

  // 탭
  await page.getByRole('tab', { name: '곡 정보' }).click()
  await page.waitForTimeout(150)
  const info = (await page.locator('aside').innerText()).replace(/\s+/g, ' ')
  check('곡 정보 탭', info.includes('앨범 아티스트') && info.includes('인디') && info.includes('1-02 새벽 버스.flac'), info.slice(0, 200))
  check('음질 표시: 파일, 출력', /파일 FLAC 96 kHz \/ 24 bit, [\d,]+ kbps/.test(info) && /출력 \d+(\.\d+)? kHz, 시스템 기본 장치/.test(info), info.slice(-90))
  await page.getByRole('tab', { name: '대기열' }).click()
  await page.waitForTimeout(150)
  check('대기열 탭', (await page.locator('aside').innerText()).includes('돌아오는 길'))
  await page.getByRole('tab', { name: '이퀄라이저' }).click()
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(shots, 'now-playing-eq.jpg'), type: 'jpeg', quality: 88 })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(shots, 'now-playing-white.jpg'), type: 'jpeg', quality: 88 })
  await page.emulateMedia({ colorScheme: 'dark' })

  // 폴더 이미지 표지
  await page.goto(`${url}#/albums`)
  await openAlbum('Slow Weather')
  await row('Rain').locator('button').first().click()
  await enterPlayer()
  check('폴더 이미지도 원본으로', await page.waitForFunction(() => document.querySelector('main img')?.naturalWidth === 800, null, { timeout: 5000 }).then(() => true, () => false))
  await page.evaluate(() => window.__audio.pause())

  // 재생목록 만들기
  await page.getByRole('link', { name: '라이브러리' }).click()
  await page.getByRole('heading', { name: 'Slow Weather', level: 1 }).waitFor()
  await openAlbum('유리 온실')
  await menu('창문을 열면')
  await item('새 재생목록').click()
  await page.getByRole('textbox', { name: '이름' }).fill('아침')
  await page.getByRole('dialog').getByRole('button', { name: '만들기' }).click()
  await page.waitForTimeout(200)
  check('새 재생목록 만들기', (await notice()).includes('재생목록을 만들었습니다: 아침'), await notice())
  await menu('돌아오는 길')
  await item('아침').click()
  await openAlbum('오후 세 시')
  await page.getByRole('button', { name: '더 보기: 오후 세 시' }).click()
  await item('아침').click()
  await page.waitForTimeout(150)
  await nav('재생목록')
  await page.getByRole('heading', { name: '재생목록', level: 1 }).waitFor()
  await page.waitForTimeout(200)
  check('재생목록 목록', (await main().innerText()).includes('아침') && (await main().innerText()).includes('4곡'), (await main().innerText()).replace(/\s+/g, ' ').slice(0, 100))
  await main().getByRole('link', { name: /아침/ }).click()
  await page.getByRole('heading', { name: '아침', level: 1 }).waitFor()
  await page.waitForTimeout(200)
  const titles = () => main().locator('ol li button > span:nth-child(2) > span:first-child').allInnerTexts()
  check('곡 순서', JSON.stringify(await titles()) === JSON.stringify(['창문을 열면', '돌아오는 길', '비 오는 금요일', '저녁']), (await titles()).join(' | '))

  // 순서 바꾸기
  await menu('저녁')
  await item('위로 이동').click()
  await page.waitForTimeout(150)
  check('메뉴로 위로 이동', (await titles())[2] === '저녁', (await titles()).join(' | '))
  await row('창문을 열면').dragTo(row('저녁'), { targetPosition: { x: 200, y: 50 } })
  await page.waitForTimeout(250)
  check('끌어서 순서 변경', (await titles()).indexOf('창문을 열면') === 2, (await titles()).join(' | '))
  await menu('비 오는 금요일')
  await item('재생목록에서 제거').click()
  await page.waitForTimeout(150)
  check('재생목록에서 제거', (await titles()).length === 3 && !(await titles()).includes('비 오는 금요일'), (await titles()).join(' | '))

  // 재생
  await page.getByRole('button', { name: '재생', exact: true }).first().click()
  await page.waitForFunction(() => !window.__audio.paused, null, { timeout: 4000 })
  check('재생목록 재생', (await titles())[0] === (await bar().locator('a span span').first().innerText()), await bar().locator('a span span').first().innerText())
  await menu((await titles())[1])
  await item('다음에 재생').click()
  await page.waitForTimeout(150)
  check('다음에 재생', (await notice()).includes('다음에 재생합니다'), await notice())
  await page.evaluate(() => window.__audio.pause())

  // 이름 변경, 유지
  await page.getByRole('button', { name: '이름 변경' }).click()
  await page.getByRole('textbox', { name: '이름' }).fill('아침 산책')
  await page.getByRole('dialog').getByRole('button', { name: '변경' }).click()
  await page.getByRole('heading', { name: '아침 산책', level: 1 }).waitFor()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: '아침 산책', level: 1 }).waitFor({ timeout: 8000 })
  await page.waitForTimeout(300)
  check('새로고침 후 재생목록 유지', (await titles()).length === 3, (await titles()).join(' | '))

  // 내보내기
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '내보내기' }).click()
  const saved = await download
  const exported = JSON.parse(fs.readFileSync(await saved.path(), 'utf8'))
  check('내보내기 파일', saved.suggestedFilename() === 'music-player-playlists.json' && exported.format === 'music-player-playlists' && exported.playlists[0].name === '아침 산책' && exported.playlists[0].entries.length === 3, saved.suggestedFilename())
  check('내보내기 파일에 폴더 id가 없음', !JSON.stringify(exported).includes('legacy') && exported.playlists[0].entries[0].folder === 'library', JSON.stringify(exported.playlists[0].entries[0]))
  fs.writeFileSync(path.join(shots, 'export.json'), JSON.stringify(exported))

  // 폴더를 제거했다가 다시 추가
  await page.goto(`${url}#/folders`)
  await main().locator('li', { hasText: 'library' }).getByRole('button', { name: '제거' }).click()
  await page.waitForTimeout(500)
  const removed = await dbInfo()
  check('폴더 제거: 파형도 삭제, 재생목록은 유지', removed.waves === 0 && removed.playlists === 1, JSON.stringify(removed))
  await nav('재생목록')
  await main().getByRole('link', { name: /아침 산책/ }).click()
  await page.getByRole('heading', { name: '아침 산책', level: 1 }).waitFor()
  await page.waitForTimeout(200)
  check('폴더가 없으면 찾지 못한 곡 표시', (await main().innerText()).includes('찾지 못한 곡 3개') && (await main().innerText()).includes('곡이 있는 폴더를 연결하면'), (await main().innerText()).replace(/\s+/g, ' ').slice(0, 120))
  await page.evaluate(() => localStorage.setItem('t:pick', 'library'))
  await side().getByRole('button', { name: '폴더 추가' }).click()
  await main().locator('ol li').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(600)
  check('폴더를 다시 추가하면 재생목록 복구', (await titles()).length === 3 && !(await main().innerText()).includes('찾지 못한'), (await titles()).join(' | '))

  // 삭제
  await page.getByRole('button', { name: '삭제', exact: true }).click()
  check('삭제 전에 확인', (await page.getByRole('dialog').innerText()).includes('음악 파일은 그대로 남습니다'))
  await page.getByRole('dialog').getByRole('button', { name: '삭제' }).click()
  await page.getByRole('heading', { name: '재생목록', level: 1 }).waitFor()
  await page.waitForTimeout(200)
  check('재생목록 삭제', (await dbInfo()).playlists === 0)

  // 가져오기
  const importFile = async (buffer, name = 'list.json') => {
    const chooser = page.waitForEvent('filechooser')
    await main().getByRole('button', { name: '가져오기' }).click()
    await (await chooser).setFiles({ name, mimeType: 'application/json', buffer })
    await page.waitForTimeout(300)
  }
  await importFile(Buffer.from(JSON.stringify(exported)))
  check('가져오기', (await notice()).includes('재생목록 1개를 가져왔습니다') && (await main().innerText()).includes('아침 산책'), await notice())
  await importFile(Buffer.from(JSON.stringify(exported)))
  check('같은 이름은 번호를 붙임', (await main().innerText()).includes('아침 산책 (2)'))
  await importFile(Buffer.from('{"hello":1}'))
  check('다른 JSON은 거부', (await notice()).includes('재생목록 파일이 아닙니다'), await notice())
  await importFile(Buffer.from('이건 JSON이 아님'))
  check('깨진 파일은 거부', (await notice()).includes('재생목록 파일이 아닙니다'))
  await importFile(Buffer.from(JSON.stringify({ format: 'music-player-playlists', version: 1, playlists: [{ name: '옮긴 곡', entries: [{ folder: '다른 PC', path: '없는/경로.flac', title: '새벽 버스', artist: '밤의 정류장', album: '유리 온실' }, { folder: '다른 PC', path: '없는/곡.mp3', title: '없는 곡' }] }] })))
  await main().getByRole('link', { name: /옮긴 곡/ }).click()
  await page.getByRole('heading', { name: '옮긴 곡', level: 1 }).waitFor()
  await page.waitForTimeout(200)
  check('경로가 달라도 태그로 곡을 찾음', (await titles())[0] === '새벽 버스' && (await main().innerText()).includes('찾지 못한 곡 1개'), (await main().innerText()).replace(/\s+/g, ' ').slice(0, 100))

  // 휴대폰
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${url}#/now-playing?tab=eq`, { waitUntil: 'networkidle' })
  await page.getByRole('switch', { name: '이퀄라이저 사용' }).waitFor()
  await page.waitForTimeout(300)
  check('휴대폰: 전체 화면 가로 넘침 없음', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: path.join(shots, 'now-playing-mobile.jpg'), type: 'jpeg', quality: 88, fullPage: false })
  await page.evaluate(() => { const scroller = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 40 && getComputedStyle(d).overflowY === 'auto'); if (scroller) scroller.scrollTop = scroller.scrollHeight })
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(shots, 'now-playing-mobile-eq.jpg'), type: 'jpeg', quality: 88 })
  await page.setViewportSize({ width: 1440, height: 900 })

  const real = problems.filter((p) => !p.includes('no supported source') && !p.includes('Unable to decode'))
  check('오류 없음', real.length === 0, real.slice(0, 4).join(' | '))

  await browser.close()
  server.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
