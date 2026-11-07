// 측정 화면 검증: 그려진 픽셀과 값을 실제 신호와 비교한다.
// usage: node verify14.cjs <distDir> <shotDir> <songFolder>
const { spawnSync } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')

const [dist, shots, songFolder] = process.argv.slice(2)
const FX = path.join(__dirname, '..', 'out', 'fixtures', 'scope')
const VU = path.join(__dirname, '..', 'out', 'fixtures', 'vu')
const RESTORE = path.join(__dirname, '..', 'out', 'fixtures', 'restore-app')
const SONG = 'Oliver Tree - Life Goes On.flac'
const BASE = '/music-player/'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` (${detail})` : ''}`) }
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance

function makeFixtures() {
  fs.mkdirSync(FX, { recursive: true })
  const file = path.join(FX, 'anti.flac')
  if (!fs.existsSync(file)) {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'aevalsrc=0.4472*sin(2*PI*1000*t):s=48000:d=40', '-af', 'pan=stereo|c0=c0|c1=-1*c0', '-metadata', 'title=역위상', '-metadata', 'artist=측정', '-metadata', 'album=측정', file], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(r.stderr)
  }
  const list = new Map()
  list.set('anti.flac', file)
  list.set('ref.flac', path.join(VU, 'ref.flac'))
  list.set('left.flac', path.join(VU, 'left.flac'))
  list.set('mp3.mp3', path.join(RESTORE, 'a.mp3'))
  list.set('real.flac', path.join(RESTORE, 'd.flac'))
  list.set(SONG, path.join(songFolder, SONG))
  return list
}

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
      constructor(options) { super(window.__forceRate ? { ...options, sampleRate: window.__forceRate } : options) }
      createMediaElementSource(el) { window.__sources += 1; window.__graph = this; return super.createMediaElementSource(el) }
    }
    window.__frames = 0
    const nativeRaf = window.requestAnimationFrame.bind(window)
    const nativeCancel = window.cancelAnimationFrame.bind(window)
    const live = new Map()
    let shown = -Infinity
    let nextId = 1
    window.requestAnimationFrame = (fn) => {
      window.__frames += 1
      const id = nextId++
      const wait = (now) => {
        const gap = window.__frameMs ?? 0
        if (now !== shown && now - shown < gap - 1) { live.set(id, nativeRaf(wait)); return }
        live.delete(id)
        shown = now
        fn(now)
      }
      live.set(id, nativeRaf(wait))
      return id
    }
    window.cancelAnimationFrame = (id) => {
      if (live.has(id)) nativeCancel(live.get(id))
      live.delete(id)
    }
    const connect = AudioNode.prototype.connect
    AudioNode.prototype.connect = function (target, ...rest) {
      if (target instanceof AudioDestinationNode) {
        const c = this.context
        if (!c.__out) { c.__out = c.createAnalyser(); c.__out.fftSize = 8192 }
        connect.call(this, c.__out)
      }
      return connect.call(this, target, ...rest)
    }
    window.__outPeak = async (ms) => {
      const m = window.__graph.__out, a = new Float32Array(m.fftSize)
      let peak = 0
      const end = performance.now() + ms
      while (performance.now() < end) {
        m.getFloatTimeDomainData(a)
        for (const v of a) peak = Math.max(peak, Math.abs(v))
        await new Promise((r) => setTimeout(r, 40))
      }
      return peak
    }
    // 스펙트로그램의 최근 세로줄 밝기를 위치별로 읽는다. 0이 맨 위(높은 소리)다.
    window.__rows = (columns = 12) => {
      const canvas = document.querySelector('[data-module="spectrogram"]')
      const { width, height } = canvas
      const data = canvas.getContext('2d').getImageData(width - columns, 0, columns, height).data
      const rows = new Float32Array(height)
      for (let y = 0; y < height; y++) {
        let sum = 0
        for (let x = 0; x < columns; x++) { const i = (y * columns + x) * 4; sum += data[i] + data[i + 1] + data[i + 2] }
        rows[y] = sum / columns / 3
      }
      return [...rows]
    }
    window.__position = (hz) => 1 - Math.log(hz / 30) / Math.log(22000 / 30)
    window.__brightestAt = () => {
      const rows = window.__rows()
      let best = 0
      rows.forEach((v, i) => { if (v > rows[best]) best = i })
      return { position: (best + 0.5) / rows.length, value: rows[best] }
    }
    window.__bandBrightness = (fromHz, toHz) => {
      const rows = window.__rows(60)
      const a = Math.floor(window.__position(toHz) * rows.length), b = Math.ceil(window.__position(fromHz) * rows.length)
      return rows.slice(a, b).reduce((s, v) => s + v, 0) / (b - a)
    }
    window.__vectorResidue = () => {
      const canvas = document.querySelector('[data-module="vectorscope"]')
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let top = 0
      const { width, height } = canvas
      const size = Math.min(width, height) * 0.46
      for (let i = 0; i < data.length; i += 4) {
        const x = (i / 4) % width, y = Math.floor(i / 4 / width)
        // L, R 글자 가장자리는 궤적이 아니다
        const label = y < height * 0.4 && Math.abs(Math.abs(x - width / 2) - size * 0.82) < 10
        if (!label && data[i + 2] > data[i] + 25 && data[i + 3] > top) top = data[i + 3]
      }
      return top
    }
    // 벡터스코프 궤적이 퍼진 방향을 잰다
    window.__vector = () => {
      const canvas = document.querySelector('[data-module="vectorscope"]')
      const { width, height } = canvas
      const data = canvas.getContext('2d').getImageData(0, 0, width, height).data
      let xx = 0, yy = 0, xy = 0, n = 0
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        // 격자는 회색이라 궤적의 파란색만 센다
        if (data[i + 3] > 20 && data[i + 2] > data[i] + 25) { const dx = x - width / 2, dy = y - height / 2; xx += dx * dx; yy += dy * dy; xy += dx * dy; n++ }
      }
      return { xx: xx / Math.max(n, 1), yy: yy / Math.max(n, 1), slant: xy / Math.sqrt(Math.max(xx * yy, 1)), n }
    }
    // 궤적이 가운데 세로줄을 비우는지 잰다
    window.__vectorStrips = () => {
      const canvas = document.querySelector('[data-module="vectorscope"]')
      const { width, height } = canvas
      const data = canvas.getContext('2d').getImageData(0, 0, width, height).data
      const count = (from, to) => {
        let n = 0
        for (let y = 0; y < height; y++) for (let x = Math.floor(width / 2 + from); x < Math.floor(width / 2 + to); x++) {
          const i = (y * width + x) * 4
          if (data[i + 3] > 30 && data[i + 2] > data[i] + 25) n++
        }
        return n
      }
      return { center: count(-4, 4), side: count(10, 18) }
    }
  } catch {}
}

;(async () => {
  const fixtures = makeFixtures()
  const names = [...fixtures.keys()]
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    if (!url.startsWith(BASE)) { res.writeHead(404); return res.end() }
    const rel = url.slice(BASE.length) || 'index.html'
    const file = rel.startsWith('__fx/') ? fixtures.get(rel.slice(5)) : path.join(dist, rel)
    if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  fs.mkdirSync(shots, { recursive: true })
  await new Promise((r) => server.listen(4195, r))
  const browser = await chromium.launch({ channel: 'msedge' })

  // 계산은 실제 모듈로
  const unit = await browser.newPage()
  await unit.goto('http://localhost:5173/src/main.tsx')
  const math = await unit.evaluate(async () => {
    const { getStereoStats, createRowBins, createColorTable, getFrequencyPosition } = await import('/src/lib/player/scope.ts')
    const n = 2048
    const sine = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / 48000))
    const other = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 1733 * i) / 48000))
    const inverted = sine.map((v) => -v)
    const zero = new Float32Array(n)
    const bins = createRowBins(300, 48000 / 4096, 2048)
    let ordered = true
    for (let row = 1; row < 300; row++) if (bins[row * 2] > bins[(row - 1) * 2]) ordered = false
    const table = createColorTable()
    const brightness = (l) => table[l * 3] + table[l * 3 + 1] + table[l * 3 + 2]
    let rising = true
    for (let l = 1; l < 256; l++) if (brightness(l) < brightness(l - 1)) rising = false
    return {
      same: getStereoStats(sine, sine),
      opposite: getStereoStats(sine, inverted),
      leftOnly: getStereoStats(sine, zero),
      rightOnly: getStereoStats(zero, sine),
      unrelated: getStereoStats(sine, other),
      silence: getStereoStats(zero, zero),
      ordered, rising,
      end: [getFrequencyPosition(30), getFrequencyPosition(22000)],
    }
  })
  await unit.close()
  check('계산: 같은 소리는 위상 +1, 가운데', near(math.same.correlation, 1, 0.001) && near(math.same.balance, 0, 0.001))
  check('계산: 뒤집은 소리는 위상 -1', near(math.opposite.correlation, -1, 0.001))
  check('계산: 왼쪽만이면 위상 0, 왼쪽 끝', math.leftOnly.correlation === 0 && near(math.leftOnly.balance, -1, 0.001))
  check('계산: 오른쪽만이면 오른쪽 끝', near(math.rightOnly.balance, 1, 0.001))
  check('계산: 무관한 두 소리는 위상 0 근처', Math.abs(math.unrelated.correlation) < 0.1, math.unrelated.correlation.toFixed(3))
  check('계산: 무음이면 값 없음', math.silence === null)
  check('계산: 줄이 주파수 순서대로', math.ordered)
  check('색: 큰 소리일수록 밝음', math.rising)

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  if (process.env.FORCE_RATE) await ctx.addInitScript(`window.__forceRate = ${Number(process.env.FORCE_RATE)}`)
  if (process.env.FRAME_MS) await ctx.addInitScript(`window.__frameMs = ${Number(process.env.FRAME_MS)}`)
  await ctx.addInitScript(stub)
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) problems.push(`console: ${m.text()}`) })

  await page.goto(`http://localhost:4195${BASE}`, { waitUntil: 'networkidle' })
  await page.evaluate(async (list) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('fx', { create: true })
    for (const name of list) {
      const bytes = await (await fetch(`__fx/${encodeURIComponent(name)}`)).arrayBuffer()
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
      await w.write(bytes); await w.close()
    }
  }, names)
  await page.getByRole('region', { name: '폴더' }).getByRole('button', { name: '폴더 추가' }).click()
  await page.waitForFunction((n) => window.__reads.read >= n, names.length, { timeout: 40000 })
  await page.waitForTimeout(500)

  const scope = page.locator('[data-scope]')
  const nowPlaying = async () => {
    await page.evaluate(() => { location.hash = '#/now-playing?tab=sound' })
    await page.getByRole('switch', { name: '원음 듣기' }).waitFor()
    await page.waitForTimeout(150)
  }
  const play = async (title) => {
    await page.evaluate(() => { location.hash = '#/folders' })
    await page.locator('main li', { hasText: 'fx' }).getByRole('link').click()
    await page.locator('main ol li').first().waitFor()
    await page.locator('main ol li', { hasText: title }).first().locator('button').first().click()
    await page.waitForFunction((t) => document.title.startsWith(`${t} - `) && !window.__audio.paused && window.__audio.currentTime > 0.1, title, { timeout: 8000 })
    await nowPlaying()
  }
  const setting = async (name, label) => {
    await page.evaluate(() => { location.hash = '#/settings' })
    await page.locator(`input[name="${name}"]`).first().waitFor({ state: 'attached' })
    await page.locator(`label:has(input[name="${name}"])`, { hasText: new RegExp(`^${label}$`) }).click()
    await page.waitForTimeout(120)
  }
  const stat = (name) => page.evaluate((n) => document.querySelector('[data-module="stereo"]').dataset[n] ?? '', name)
  const slotButton = (index) => page.locator(`[data-slot-index="${index}"] button`)
  const choose = async (index, label) => {
    await slotButton(index).click()
    await page.getByRole('menuitem', { name: label, exact: true }).click()
    await page.waitForTimeout(250)
  }
  const modules = () => page.evaluate(() => [...document.querySelectorAll('[data-module]')].map((e) => e.dataset.module))
  const columns = () => page.evaluate(() => Number(document.querySelector('[data-module="spectrogram"]').dataset.columns ?? 0))

  await play('기준 사인')
  check('기본은 측정이 꺼져 있음', (await scope.count()) === 0)
  check('기본은 그래프 없이 재생', (await page.evaluate(() => window.__sources)) === 0)
  await setting('cover-view', '측정')
  check('재생이 끊기지 않음', await page.evaluate(() => !window.__audio.paused))
  await nowPlaying()
  check('표지 자리에 측정', (await scope.count()) === 1)
  check('기본 구성', (await modules()).join() === 'spectrogram,vectorscope,level', (await modules()).join())
  await choose(2, '위상과 좌우')
  check('칸을 눌러 모듈을 바꿈', (await modules()).join() === 'spectrogram,vectorscope,stereo', (await modules()).join())
  const box = await scope.boundingBox()
  check('정사각형 표지 자리', near(box.width, box.height, 2), `${Math.round(box.width)}x${Math.round(box.height)}`)
  const clean = await page.evaluate(() => window.__outPeak(500))
  check('측정을 켜도 소리는 그대로', near(clean, 0.4472, 0.002), clean.toFixed(4))

  // 스펙트로그램
  await page.waitForTimeout(1500)
  const line = await page.evaluate(() => ({ ...window.__brightestAt(), want: window.__position(1000) }))
  check('1kHz 사인이 1kHz 줄에 보임', near(line.position, line.want, 0.02) && line.value > 100, `위치 ${line.position.toFixed(3)}, 목표 ${line.want.toFixed(3)}, 밝기 ${line.value.toFixed(0)}`)
  const elsewhere = await page.evaluate(() => [window.__bandBrightness(5000, 20000), window.__bandBrightness(40, 200)])
  check('다른 주파수는 어두움', elsewhere.every((v) => v < 40), elsewhere.map((v) => v.toFixed(0)).join(', '))

  // 시간으로 흐름
  const c0 = await columns(), t0 = Date.now()
  await page.waitForTimeout(2000)
  const rate = ((await columns()) - c0) / ((Date.now() - t0) / 1000)
  check('초당 40줄로 흐름', near(rate, 40, 4), `${rate.toFixed(1)}줄/초`)

  // 버퍼가 커도 화면이 부드러운지
  const motion = await page.evaluate(async () => {
    const canvas = document.querySelector('[data-module="spectrogram"]')
    const context = canvas.getContext('2d')
    const columnsOf = () => {
      const data = context.getImageData(canvas.width - 60, 0, 60, canvas.height).data
      const sums = new Float64Array(60)
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < 60; x++) sums[x] += data[(y * 60 + x) * 4] * (y + 1)
      return sums
    }
    return columnsOf()
  })
  console.log(`INFO 최근 줄 ${motion.length}개`)

  // 위상과 좌우
  await page.waitForTimeout(500)
  const steadiness = await page.evaluate(async () => {
    const element = document.querySelector('[data-module="stereo"]')
    const seen = {}
    const end = performance.now() + 6000
    while (performance.now() < end) {
      seen[element.dataset.correlation] = (seen[element.dataset.correlation] ?? 0) + 1
      await new Promise((r) => setTimeout(r, 40))
    }
    return seen
  })
  check('가운데 소리: 위상이 계속 +1.00', Object.keys(steadiness).length === 1 && steadiness['+1.00'] > 0, JSON.stringify(steadiness))
  check('가운데 소리: 좌우 가운데', (await stat('balance')) === '가운데', await stat('balance'))
  const middle = await page.evaluate(() => window.__vector())
  check('가운데 소리: 벡터스코프가 세로줄', middle.yy > middle.xx * 20 && middle.n > 50, `세로 ${middle.yy.toFixed(0)}, 가로 ${middle.xx.toFixed(0)}, 점 ${middle.n}`)

  await play('왼쪽만')
  await page.waitForTimeout(1000)
  check('왼쪽만: 위상 0', Math.abs(Number(await stat('correlation'))) < 0.02, await stat('correlation'))
  check('왼쪽만: 왼쪽 100', (await stat('balance')) === '왼쪽 100', await stat('balance'))
  const leftOnly = await page.evaluate(() => window.__vector())
  check('왼쪽만: 벡터스코프가 왼쪽 대각선', leftOnly.slant > 0.9, `기울기 ${leftOnly.slant.toFixed(2)}, 점 ${leftOnly.n}`)

  await play('역위상')
  await page.waitForTimeout(1000)
  check('역위상: 위상 -1.00', (await stat('correlation')) === '-1.00', await stat('correlation'))
  const side = await page.evaluate(() => window.__vector())
  check('역위상: 벡터스코프가 가로줄', side.xx > side.yy * 20, `세로 ${side.yy.toFixed(0)}, 가로 ${side.xx.toFixed(0)}`)
  await page.waitForTimeout(600)
  const anti = await page.evaluate(() => ({ ...window.__brightestAt(), want: window.__position(1000) }))
  check('역위상 소리도 스펙트로그램에 보임', near(anti.position, anti.want, 0.02) && anti.value > 100, `밝기 ${anti.value.toFixed(0)}`)

  // 움직이는 소리로 시간 해상도를 본다. 덩어리째 그리면 같은 줄이 여러 개 겹친다.
  await play('Life Goes On')
  await page.evaluate(() => { window.__audio.currentTime = 43 })
  await page.waitForTimeout(3000)
  const repeats = await page.evaluate(() => {
    const canvas = document.querySelector('[data-module="spectrogram"]')
    const width = 60
    const data = canvas.getContext('2d').getImageData(canvas.width - width, 0, width, canvas.height).data
    const column = (x) => { const out = []; for (let y = 0; y < canvas.height; y++) out.push(data[(y * width + x) * 4]); return out.join() }
    let same = 0
    for (let x = 1; x < width; x++) if (column(x) === column(x - 1)) same += 1
    return same / (width - 1)
  })
  check('버퍼가 커도 스펙트로그램이 덩어리지지 않음', repeats < 0.15, `같은 줄 ${(repeats * 100).toFixed(0)}%`)

  // 처리가 켜지면 덩어리를 만드는 데 시간이 걸린다. 그 사이에 읽으면 화면이 멈춘다.
  const sameLines = () => page.evaluate(() => {
    const canvas = document.querySelector('[data-module="spectrogram"]')
    const width = 120
    const data = canvas.getContext('2d').getImageData(canvas.width - width, 0, width, canvas.height).data
    const column = (x) => { const out = []; for (let y = 0; y < canvas.height; y++) out.push(data[(y * width + x) * 4]); return out.join() }
    let same = 0
    for (let x = 1; x < width; x++) if (column(x) === column(x - 1)) same += 1
    return same / (width - 1)
  })
  await page.getByRole('slider', { name: '진공관', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(3600)
  const tubeLines = await sameLines()
  check('효과를 켜도 측정이 멈추지 않음 (진공관)', tubeLines < 0.1, `같은 줄 ${(tubeLines * 100).toFixed(0)}%`)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await page.getByRole('tab', { name: '이퀄라이저', exact: true }).click()
  await page.getByRole('switch', { name: '이퀄라이저 사용' }).click()
  await page.waitForTimeout(3600)
  const eqLines = await sameLines()
  check('효과를 켜도 측정이 멈추지 않음 (EQ 평탄)', eqLines < 0.1, `같은 줄 ${(eqLines * 100).toFixed(0)}%`)
  await page.getByRole('switch', { name: '이퀄라이저 사용' }).click()
  await page.getByRole('tab', { name: '음향', exact: true }).click()
  await page.getByRole('switch', { name: '원음 듣기' }).waitFor()

  // 고역이 잘린 곡이 눈에 보이는지
  await play('압축 128')
  await page.evaluate(() => { window.__audio.currentTime = 12 })
  await page.waitForTimeout(3200)
  const lossy = await page.evaluate(() => ({ low: window.__bandBrightness(10000, 14000), high: window.__bandBrightness(18000, 21000) }))
  await play('진짜 무손실')
  await page.evaluate(() => { window.__audio.currentTime = 12 })
  await page.waitForTimeout(3200)
  const lossless = await page.evaluate(() => ({ low: window.__bandBrightness(10000, 14000), high: window.__bandBrightness(18000, 21000) }))
  check('압축본은 18kHz 위가 어두움', lossy.low > lossy.high + 30, `아래 ${lossy.low.toFixed(0)}, 위 ${lossy.high.toFixed(0)}`)
  check('무손실은 18kHz 위까지 보임', lossless.high > lossy.high + 25, `무손실 ${lossless.high.toFixed(0)}, 압축 ${lossy.high.toFixed(0)}`)

  // 고역 복원이 눈에 보이는지
  await play('압축 128')
  await group()
  async function group() {
    await page.locator('label:has(input[name="restore"])', { hasText: /^강$/ }).click()
  }
  await page.waitForTimeout(8500)
  const restored = await page.evaluate(() => window.__bandBrightness(18000, 21000))
  check('고역 복원을 켜면 빈 대역이 보임', restored > lossy.high + 25, `복원 ${restored.toFixed(0)}, 전 ${lossy.high.toFixed(0)}`)
  await page.getByRole('button', { name: '초기화' }).click()

  // 실제 곡과 멈춤
  await play('Life Goes On')
  await page.evaluate(() => { window.__audio.currentTime = 43 })
  await page.waitForTimeout(3000)
  const correlation = Number(await stat('correlation'))
  check('실제 곡: 위상이 정상 범위', correlation > -0.2 && correlation <= 1, await stat('correlation'))
  const strips = await page.evaluate(() => window.__vectorStrips())
  check('실제 곡: 벡터스코프 가운데가 비지 않음', strips.center >= strips.side * 0.9, `가운데 ${strips.center}, 옆 ${strips.side}`)
  await page.screenshot({ path: path.join(shots, 'scope-black.jpg'), type: 'jpeg', quality: 90 })

  await page.getByRole('button', { name: '일시정지' }).click()
  await page.waitForTimeout(1500)
  const residue = await page.evaluate(() => window.__vectorResidue())
  console.log(`INFO 잔상 픽셀 ${JSON.stringify(await page.evaluate(() => window.__residueHits))}`)
  check('멈추면 벡터스코프 잔상이 남지 않음', residue <= 6, `최대 불투명도 ${residue}/255`)
  const history = await page.evaluate(() => window.__bandBrightness(300, 3000))
  const stopped = await columns()
  const framesBefore = await page.evaluate(() => window.__frames)
  await page.waitForTimeout(800)
  check('멈추면 스펙트로그램도 멈춤', (await columns()) === stopped)
  check('멈춘 뒤에는 그리기를 쉼', (await page.evaluate(() => window.__frames)) - framesBefore < 5, `${(await page.evaluate(() => window.__frames)) - framesBefore}프레임`)
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await page.waitForTimeout(800)
  check('다시 재생하면 이어서 흐름', (await columns()) > stopped)
  const kept = await page.evaluate(() => {
    const canvas = document.querySelector('[data-module="spectrogram"]')
    const data = canvas.getContext('2d').getImageData(canvas.width - 120, 0, 60, canvas.height).data
    let sum = 0
    for (let i = 0; i < data.length; i += 4) sum += data[i + 2]
    return sum / (data.length / 4)
  })
  check('일시정지해도 스펙트로그램 기록이 남음', kept > 40, `밝기 ${kept.toFixed(0)}, 멈추기 전 ${history.toFixed(0)}`)

  // 모듈마다 값이 맞는지
  await page.evaluate(() => { window.__audio.pause() })
  await play('기준 사인')
  await choose(2, '레벨')
  await choose(1, '스펙트럼')
  await page.waitForTimeout(1600)
  const meter = (name, key) => page.evaluate(([n, k]) => document.querySelector(`[data-module="${n}"]`).dataset[k] ?? '', [name, key])
  const rmsValue = Number(await meter('level', 'rms'))
  check('레벨: -10 dBFS 사인이 RMS -10', near(rmsValue, -10, 0.3), String(rmsValue))
  const sineLufs = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', fixtures.get('ref.flac'), '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
  const wantSine = Number(/I:\s+(-?[\d.]+) LUFS/.exec(sineLufs.slice(sineLufs.lastIndexOf('Summary:')))[1])
  const gotSine = Number(await meter('level', 'lufs'))
  check('레벨: LUFS가 ffmpeg 측정과 같음 (사인)', near(gotSine, wantSine, 0.3), `앱 ${gotSine}, ffmpeg ${wantSine}`)
  const note = await meter('spectrum', 'note')
  check('스펙트럼: 1kHz와 음 이름', /^(999|100[0-1]) Hz  B5 \+2[0-2]¢$/.test(note), note)
  await choose(1, '오실로스코프')
  await page.waitForTimeout(700)
  const scopeStill = await page.evaluate(async () => {
    const canvas = document.querySelector('[data-module="oscilloscope"]')
    const context = canvas.getContext('2d')
    const grab = () => context.getImageData(0, 0, canvas.width, canvas.height).data
    const first = grab()
    await new Promise((r) => setTimeout(r, 400))
    const second = grab()
    let changed = 0, lit = 0
    for (let i = 0; i < first.length; i += 4) { if (first[i + 2] > 120) lit++; if (Math.abs(first[i + 2] - second[i + 2]) > 60) changed++ }
    return { changed: changed / Math.max(lit, 1), lit }
  })
  check('오실로스코프: 사인이 제자리에 서 있음', scopeStill.lit > 50 && scopeStill.changed < 0.35, `변한 비율 ${(scopeStill.changed * 100).toFixed(0)}%, 켜진 점 ${scopeStill.lit}`)
  await choose(1, 'VU')
  await page.waitForTimeout(1400)
  const vuValue = Number(await meter('vu', 'vu'))
  check('VU 모듈: -10 dBFS 사인이 0 VU', near(vuValue, 0, 0.4), String(vuValue))

  // 실제 곡의 LUFS
  await choose(0, '스펙트럼')
  await play('Life Goes On')
  await page.evaluate(() => { window.__audio.currentTime = 43 })
  await page.waitForTimeout(800)
  const collected = await page.evaluate(async () => {
    const element = document.querySelector('[data-module="level"]')
    const values = []
    const end = performance.now() + 8000
    while (performance.now() < end) {
      const v = Number(element.dataset.lufs)
      if (Number.isFinite(v)) values.push(v)
      await new Promise((r) => setTimeout(r, 200))
    }
    return values
  })
  const energy = collected.reduce((sum, v) => sum + 10 ** (v / 10), 0) / collected.length
  const appLufs = 10 * Math.log10(energy)
  const songLufs = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-ss', '43.8', '-t', '8', '-i', fixtures.get(SONG), '-af', 'aresample=48000,ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
  const wantSong = Number(/I:\s+(-?[\d.]+) LUFS/.exec(songLufs.slice(songLufs.lastIndexOf('Summary:')))[1])
  check('레벨: 실제 곡의 LUFS가 ffmpeg 측정과 비슷함', near(appLufs, wantSong, 1.2), `앱 ${appLufs.toFixed(1)}, ffmpeg ${wantSong}`)
  const vuSong = await page.evaluate(async () => {
    const vu = document.querySelector('[data-module="vu"]')
    const level = document.querySelector('[data-module="level"]')
    const pairs = []
    const end = performance.now() + 5000
    while (performance.now() < end) {
      pairs.push([Number(vu.dataset.vu), Number(level.dataset.rms)])
      await new Promise((r) => setTimeout(r, 100))
    }
    const good = pairs.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
    const mean = (index) => good.reduce((sum, pair) => sum + pair[index], 0) / good.length
    return { vu: mean(0), rms: mean(1), top: Math.max(...good.map((pair) => pair[0])), count: good.length }
  })
  // 0 VU = -10 dBFS다. 음악은 정류 평균이 실효값보다 낮아서 VU가 조금 낮게 읽힌다.
  check('VU 모듈: 실제 곡에서 RMS와 맞음', vuSong.count > 20 && near(vuSong.vu, vuSong.rms + 10, 3.5), `평균 VU ${vuSong.vu.toFixed(1)}, 평균 RMS ${vuSong.rms.toFixed(1)}, 최고 VU ${vuSong.top.toFixed(1)}`)
  await page.screenshot({ path: path.join(shots, 'scope-modules.jpg'), type: 'jpeg', quality: 90 })
  await page.getByRole('button', { name: '일시정지' }).click()
  await page.waitForTimeout(1500)
  check('멈추면 LUFS 값이 남지 않음', (await meter('level', 'lufs')) === '-', await meter('level', 'lufs'))
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await page.waitForTimeout(1200)
  check('다시 재생하면 LUFS가 나옴', Number.isFinite(Number(await meter('level', 'lufs'))) && (await meter('level', 'lufs')) !== '-', await meter('level', 'lufs'))

  // 메뉴
  const before = (await modules()).join()
  await choose(0, '레벨')
  const swapped = (await modules()).join()
  check('다른 칸의 모듈을 고르면 자리를 바꿈', swapped.split(',')[0] === 'level' && swapped.split(',')[2] === before.split(',')[0] && new Set(swapped.split(',')).size === 3, `${before} -> ${swapped}`)

  // 보이는 모듈만 계산
  await choose(0, '오실로스코프')
  await choose(1, '벡터스코프')
  await choose(2, '레벨')
  const reads = () => page.evaluate(() => Number(document.querySelector('[data-scope]').dataset.spectrumReads ?? 0))
  const r0 = await reads()
  await page.waitForTimeout(800)
  check('주파수 모듈이 없으면 FFT를 돌리지 않음', (await reads()) === r0, `${(await reads()) - r0}회`)

  // 어느 칸에 넣어도 그려지는지
  const ids = ['스펙트로그램', '스펙트럼', '레벨', '벡터스코프', '위상과 좌우', '오실로스코프', 'VU']
  const blank = []
  for (const slot of [0, 1, 2]) {
    for (const name of ids) {
      await choose(slot, name)
      await page.waitForTimeout(450)
      const ok = await page.evaluate((index) => {
        const canvas = document.querySelector(`[data-slot-index="${index}"] canvas`)
        if (canvas.width < 20 || canvas.height < 20) return false
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
        let lit = 0
        for (let i = 0; i < data.length; i += 4) if (data[i + 2] > 60 && data[i + 3] > 20) lit += 1
        return lit > 10
      }, slot)
      if (!ok) blank.push(`${slot}:${name}`)
      if (slot < 2) await page.locator(`[data-slot-index="${slot}"]`).screenshot({ path: path.join(shots, `mod-${slot}-${ids.indexOf(name)}.png`) })
    }
  }
  check('모든 모듈이 모든 칸에 그려짐', blank.length === 0, blank.join(', '))
  await page.getByRole('button', { name: /큰 칸 바꾸기/ }).click()
  await page.getByRole('menuitem', { name: '기본값으로' }).click()
  await page.waitForTimeout(250)
  check('기본값으로 되돌림', (await modules()).join() === 'spectrogram,vectorscope,level', (await modules()).join())
  await choose(1, '스펙트럼')
  await choose(2, '위상과 좌우')
  await page.waitForTimeout(1200)
  await page.screenshot({ path: path.join(shots, 'scope-custom.jpg'), type: 'jpeg', quality: 90 })

  // 느린 기기 흉내
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await page.waitForTimeout(500)
  const slow = await page.evaluate(async () => {
    const times = []
    let last = performance.now()
    await new Promise((resolve) => {
      const step = (now) => { times.push(now - last); last = now; if (times.length < 120) requestAnimationFrame(step); else resolve() }
      requestAnimationFrame(step)
    })
    times.sort((a, b) => a - b)
    return { median: times[times.length >> 1], worst: times.at(-1) }
  })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  check('CPU 6배 제한에서도 부드러움', slow.median < 25, `중앙값 ${slow.median.toFixed(1)}ms, 최악 ${slow.worst.toFixed(1)}ms`)

  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(shots, 'scope-white.jpg'), type: 'jpeg', quality: 90 })
  await page.emulateMedia({ colorScheme: 'dark' })

  await play('기준 사인')
  await page.waitForTimeout(600)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('switch', { name: '원음 듣기' }).waitFor()
  await page.waitForTimeout(300)
  const savedSound = await page.evaluate(() => JSON.parse(localStorage.getItem('music-player:sound')))
  check('새로고침: 설정 유지', savedSound.coverView === 'scope' && savedSound.scopeSlots.join() === 'spectrogram,spectrum,stereo', `${savedSound.coverView}, ${savedSound.scopeSlots}`)
  check('새로고침: 재생 전에는 그래프 없음', (await page.evaluate(() => window.__sources)) === 0)
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await page.waitForFunction(() => !window.__audio.paused && window.__audio.currentTime > 0.1, null, { timeout: 6000 })
  await page.waitForTimeout(1200)
  check('새로고침 후 재생하면 흐름', (await columns()) > 10, String(await columns()))
  await page.waitForTimeout(1500)
  const reloaded = await page.evaluate(() => ({ ...window.__brightestAt(), want: window.__position(1000), rate: window.__graph.sampleRate }))
  check('새로고침 뒤에도 주파수 축이 맞음', near(reloaded.position, reloaded.want, 0.008), `위치 ${reloaded.position.toFixed(3)}, 목표 ${reloaded.want.toFixed(3)}, ${reloaded.rate}Hz`)
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('music-player:sound'))
    localStorage.setItem('music-player:sound', JSON.stringify({ ...saved, scopeSlots: ['level', 'level', 'hologram'] }))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('switch', { name: '원음 듣기' }).waitFor()
  await page.waitForTimeout(300)
  check('저장값이 이상하면 기본 구성', (await modules()).join() === 'spectrogram,vectorscope,level', (await modules()).join())
  await setting('cover-view', '앨범 표지')
  await nowPlaying()
  check('앨범 표지로 전환', (await scope.count()) === 0)

  const real = problems.filter((p) => !p.includes('no supported source'))
  check('오류 없음', real.length === 0, real.slice(0, 4).join(' | '))
  await browser.close()
  server.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
