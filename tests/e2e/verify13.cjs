// 백그라운드 검증: 화면이 꺼진 동안 무거운 일을 하지 않고, 켜지 않은 효과에 부하를 쓰지 않는지 본다.
// usage: node verify13.cjs <distDir> <shotDir> <songFile>
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')

const [dist, shots, song] = process.argv.slice(2)
const FX = path.join(__dirname, '..', 'out', 'fixtures', 'vu')
const BASE = '/music-player/'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` (${detail})` : ''}`) }

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
    let hidden = false
    Object.defineProperty(document, 'hidden', { get: () => hidden, configurable: true })
    Object.defineProperty(document, 'visibilityState', { get: () => (hidden ? 'hidden' : 'visible'), configurable: true })
    window.__setHidden = (value) => { hidden = value; document.dispatchEvent(new Event('visibilitychange')) }

    const NativeContext = window.AudioContext
    window.AudioContext = class extends NativeContext {
      constructor(...a) { super(...a); window.__context = this }
    }
    window.__decodes = 0
    const nativeDecode = BaseAudioContext.prototype.decodeAudioData
    BaseAudioContext.prototype.decodeAudioData = function (...a) {
      if (this.sampleRate === 8000) window.__decodes += 1
      return nativeDecode.apply(this, a)
    }
  } catch {}
}

async function measureLoad(browser) {
  const SETTINGS = {
    eqEnabled: false, preamp: 0, gains: Array(10).fill(0), bass: 0, treble: 0, balance: 0, width: 1, mono: false,
    crossfeed: 'off', tube: 0, tubeMode: 'triode', vinyl: 'off', phase: 'off', restore: 'off', limiter: true,
    trackGainDb: 0, playing: true, volume: 1, direct: false, meter: false, rpm: 100 / 3,
  }
  const run = async (steps) => {
    const page = await browser.newPage()
    await page.route('**/__song', (route) => route.fulfill({ path: song, contentType: 'application/octet-stream' }))
    await page.goto('http://localhost:5173/src/main.tsx')
    const ms = await page.evaluate(async ([list, seconds]) => {
      const RATE = 48000
      const clip = await new OfflineAudioContext(2, 1, RATE).decodeAudioData(await (await fetch('/__song')).arrayBuffer())
      const Offline = OfflineAudioContext
      let instance = null
      window.AudioContext = class extends Offline {
        constructor() { super(2, seconds * RATE, RATE); instance = this }
        createMediaElementSource() {
          const source = this.createBufferSource()
          source.buffer = clip
          source.loop = true
          source.start()
          return source
        }
        resume() { return Promise.resolve() }
      }
      Object.defineProperty(navigator, 'userActivation', { value: { hasBeenActive: true }, configurable: true })
      const graph = await import('/src/lib/player/sound-graph.ts')
      for (const settings of list) graph.updateSound(settings)
      const begin = performance.now()
      await instance.startRendering()
      return (performance.now() - begin) / seconds
    }, [steps, 40])
    await page.close()
    return ms
  }
  const bass = { ...SETTINGS, bass: 3 }
  return {
    bass: await run([bass]),
    tubeOn: await run([{ ...bass, tube: 1 }]),
    // 켰다가 끈 뒤에도 부하가 돌아오는지
    tubeOff: await run([{ ...bass, tube: 1 }, bass]),
    repeated: await run(Array.from({ length: 40 }, () => bass)),
  }
}

;(async () => {
  const files = fs.readdirSync(FX)
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    if (!url.startsWith(BASE)) { res.writeHead(404); return res.end() }
    const rel = url.slice(BASE.length) || 'index.html'
    const file = rel.startsWith('__fx/') ? path.join(FX, rel.slice(5)) : path.join(dist, rel)
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  fs.mkdirSync(shots, { recursive: true })
  await new Promise((r) => server.listen(4194, r))
  const browser = await chromium.launch({ channel: 'msedge' })

  // 부하
  const load = await measureLoad(browser)
  check('켜지 않은 진공관은 부하를 쓰지 않음', load.bass < 25, `저음만 ${load.bass.toFixed(1)}ms`)
  check('진공관을 켜면 그만큼만 듦', load.tubeOn > load.bass + 5, `${load.tubeOn.toFixed(1)}ms`)
  console.log(`INFO 켰다 끈 뒤 ${load.tubeOff.toFixed(1)}ms`)
  check('같은 설정을 반복해도 부하가 늘지 않음', load.repeated < load.bass * 1.2, `${load.repeated.toFixed(1)}ms`)

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  await ctx.addInitScript(stub)
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) problems.push(`console: ${m.text()}`) })

  await page.goto(`http://localhost:4194${BASE}`, { waitUntil: 'networkidle' })
  await page.evaluate(async (list) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('fx', { create: true })
    for (const name of list) {
      const bytes = await (await fetch(`__fx/${encodeURIComponent(name)}`)).arrayBuffer()
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
      await w.write(bytes); await w.close()
    }
  }, files)
  await page.getByRole('region', { name: '폴더' }).getByRole('button', { name: '폴더 추가' }).click()
  await page.waitForFunction((n) => window.__reads.read >= n, files.length, { timeout: 30000 })
  await page.waitForTimeout(500)

  const decodes = () => page.evaluate(() => window.__decodes)
  await page.evaluate(() => { location.hash = '#/settings' })
  await page.locator('label:has(input[name="cover-view"])', { hasText: /^VU 미터$/ }).click()
  await page.waitForTimeout(300)
  const buffer = await page.evaluate(() => window.__context.baseLatency)
  check('출력 버퍼가 충분히 큼', buffer >= 0.12, `${Math.round(buffer * 1000)}ms`)
  await page.evaluate(() => { location.hash = '#/folders' })
  await page.locator('main li', { hasText: 'fx' }).getByRole('link').click()
  await page.locator('main ol li').first().waitFor()
  await page.locator('main ol li').first().locator('button').first().click()
  await page.waitForFunction(() => !window.__audio.paused && window.__audio.currentTime > 0.1, null, { timeout: 8000 })
  await page.evaluate(() => { location.hash = '#/now-playing?tab=sound' })
  await page.getByRole('switch', { name: '원음 듣기' }).waitFor()
  await page.waitForTimeout(900)
  const first = await decodes()
  check('화면이 켜져 있으면 파형을 만듦', first === 1, `${first}회`)

  await page.evaluate(() => window.__setHidden(true))
  const title = await page.title()
  await page.getByRole('button', { name: '다음 곡' }).click()
  await page.waitForFunction((t) => document.title !== t && !window.__audio.paused && window.__audio.currentTime > 0.1, title, { timeout: 8000 })
  await page.waitForTimeout(900)
  check('화면이 꺼진 동안에는 곡이 넘어가도 파형을 만들지 않음', (await decodes()) === first, `${await decodes()}회`)
  check('화면이 꺼져도 재생은 계속됨', await page.evaluate(() => !window.__audio.paused))
  await page.evaluate(() => window.__setHidden(false))
  await page.waitForTimeout(900)
  check('화면을 켜면 그 곡의 파형을 만듦', (await decodes()) === first + 1, `${await decodes()}회`)
  await page.waitForFunction(() => document.querySelector('[data-testid=wave]')?.dataset.ready === 'true', null, { timeout: 8000 })
  check('파형이 표시됨', true)

  // 빨리 넘겨도 쌓이지 않음
  await page.evaluate(() => window.__setHidden(true))
  await page.getByRole('button', { name: '다음 곡' }).click()
  await page.waitForTimeout(150)
  await page.getByRole('button', { name: '다음 곡' }).click()
  await page.waitForTimeout(500)
  const before = await decodes()
  await page.evaluate(() => window.__setHidden(false))
  await page.waitForTimeout(900)
  check('꺼진 동안 여러 곡을 넘겨도 화면을 켜면 지금 곡만 만듦', (await decodes()) === before + 1, `${(await decodes()) - before}회`)

  const real = problems.filter((p) => !p.includes('no supported source'))
  check('오류 없음', real.length === 0, real.slice(0, 4).join(' | '))
  await browser.close()
  server.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
