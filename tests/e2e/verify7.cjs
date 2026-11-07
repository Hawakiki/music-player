// 음향 2단계 검증: 배음, 위상, 잡음, 음높이 흔들림을 재서 효과가 진짜인지 본다.
// usage: node verify7.cjs <distDir> <shotDir>
const { spawnSync } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')

const [dist, shots, songFolder] = process.argv.slice(2)
const SONG = 'Oliver Tree - Life Goes On.flac'
const FX = path.join(__dirname, '..', 'out', 'fixtures', 'sound2')
const BASE = '/music-player/'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` (${detail})` : ''}`) }
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance
const x = (v) => `x${v.toFixed(2)}`

function makeFixtures() {
  fs.mkdirSync(FX, { recursive: true })
  const run = (name, input, filters, title) => {
    const file = path.join(FX, name)
    if (fs.existsSync(file)) return
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', input]
    if (filters) args.push('-af', filters)
    args.push('-metadata', `title=${title}`, '-metadata', 'artist=측정', '-metadata', 'album=측정', file)
    const r = spawnSync('ffmpeg', args, { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(r.stderr)
  }
  const sine = (f) => `sine=frequency=${f}:duration=40:sample_rate=48000`
  const stereo = 'pan=stereo|c0=c0|c1=c0'
  run('quiet.flac', sine(1000), stereo, '작은 소리')
  run('loud.flac', sine(1000), `volume=4,${stereo}`, '큰 소리')
  run('low.flac', sine(60), `volume=4,${stereo}`, '저역')
  run('high.flac', sine(12000), `volume=4,${stereo}`, '고역')
  run('silence.flac', 'anullsrc=r=48000:cl=stereo:d=40', null, '무음')
  run('bass.flac', sine(60), `volume=7,${stereo}`, '큰 베이스')
  const mix = (name, parts, title) => {
    const file = path.join(FX, name)
    if (fs.existsSync(file)) return
    const inputs = parts.flatMap(([f]) => ['-f', 'lavfi', '-i', sine(f)])
    const scaled = parts.map(([, v], i) => `[${i}]volume=${v}[s${i}]`).join(';')
    const labels = parts.map((_, i) => `[s${i}]`).join('')
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', `${scaled};${labels}amix=inputs=${parts.length}:normalize=0,${stereo}`, '-metadata', `title=${title}`, '-metadata', 'artist=측정', '-metadata', 'album=측정', file], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(r.stderr)
  }
  mix('stack.flac', [[60, 6.4], [1000, 0.8]], '베이스와 고음')
  mix('pair.flac', [[1000, 2.8], [1040, 2.8]], '두 음')
  mix('tones.flac', [[300, 0.32], [1000, 0.32], [10000, 0.32]], '작은 세 음')
  return [...fs.readdirSync(FX), SONG]
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
    window.__sourceDisconnects = 0
    window.__allpass = null
    const NativeContext = window.AudioContext
    window.AudioContext = class extends NativeContext {
      createMediaElementSource(el) {
        window.__sources += 1
        window.__graph = this
        const node = super.createMediaElementSource(el)
        const original = node.disconnect.bind(node)
        node.disconnect = (...a) => { window.__sourceDisconnects += 1; return original(...a) }
        return node
      }
      createBiquadFilter() {
        const filter = super.createBiquadFilter()
        const remember = () => { if (filter.type === 'allpass') window.__allpass = filter }
        queueMicrotask(remember)
        return filter
      }
    }
    const connect = AudioNode.prototype.connect
    AudioNode.prototype.connect = function (target, ...rest) {
      if (target instanceof AudioDestinationNode) {
        const c = this.context
        if (!c.__meter) {
          c.__meter = c.createAnalyser()
          c.__meter.fftSize = 8192
          c.__meter.smoothingTimeConstant = 0
        }
        connect.call(this, c.__meter)
      }
      return connect.call(this, target, ...rest)
    }
    window.__level = async () => {
      const m = window.__graph?.__meter
      if (!m) return { rms: 0, peak: 0, mean: 0 }
      const a = new Float32Array(8192)
      let rms = 0, peak = 0, mean = 0
      const n = 10
      for (let i = 0; i < n; i++) {
        m.getFloatTimeDomainData(a)
        rms += Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length)
        mean += a.reduce((s, v) => s + v, 0) / a.length
        for (const v of a) peak = Math.max(peak, Math.abs(v))
        await new Promise((r) => setTimeout(r, 60))
      }
      return { rms: rms / n, peak, mean: mean / n }
    }
    window.__harmonics = async (fundamental) => {
      const m = window.__graph.__meter
      const data = new Float32Array(m.frequencyBinCount)
      const hz = window.__graph.sampleRate / m.fftSize
      const levels = [0, 0, 0, 0]
      const n = 8
      for (let i = 0; i < n; i++) {
        m.getFloatFrequencyData(data)
        for (let h = 1; h <= 4; h++) {
          const bin = Math.round((fundamental * h) / hz)
          let best = -Infinity
          for (let b = bin - 3; b <= bin + 3; b++) best = Math.max(best, data[b])
          levels[h - 1] += best
        }
        await new Promise((r) => setTimeout(r, 200))
      }
      const db = levels.map((v) => v / n)
      return { h2: db[1] - db[0], h3: db[2] - db[0], h4: db[3] - db[0] }
    }
    window.__peaks = async (freqs) => {
      const m = window.__graph.__meter
      const data = new Float32Array(m.frequencyBinCount)
      const hz = window.__graph.sampleRate / m.fftSize
      const sums = freqs.map(() => 0)
      const n = 8
      for (let i = 0; i < n; i++) {
        m.getFloatFrequencyData(data)
        freqs.forEach((f, k) => {
          const bin = Math.round(f / hz)
          sums[k] += Math.max(data[bin - 1], data[bin], data[bin + 1])
        })
        await new Promise((r) => setTimeout(r, 200))
      }
      return sums.map((v) => v / n)
    }
    // 출력을 끊김 없이 받아 둔다
    window.__capture = (seconds) => {
      const c = window.__graph
      const out = new Float32Array(Math.floor(c.sampleRate * seconds))
      const tap = c.createScriptProcessor(4096, 1, 1)
      let at = 0
      window.__captured = new Promise((resolve) => {
        tap.onaudioprocess = (e) => {
          const d = e.inputBuffer.getChannelData(0)
          out.set(d.subarray(0, Math.min(d.length, out.length - at)), at)
          at += d.length
          if (at >= out.length) { tap.onaudioprocess = null; c.__meter.disconnect(tap); tap.disconnect(); resolve(out) }
        }
      })
      connect.call(c.__meter, tap)
      connect.call(tap, c.destination)
    }
    // 10ms 구간마다 파형이 얼마나 급하게 꺾이는지 보고, 가장 심한 구간을 보통 구간과 비교한다
    window.__spike = async () => {
      const d = await window.__captured
      const size = Math.floor(window.__graph.sampleRate / 100)
      const blocks = []
      for (let s = 2; s + size < d.length; s += size) {
        let top = 0
        for (let i = s; i < s + size; i++) top = Math.max(top, Math.abs(d[i] - 2 * d[i - 1] + d[i - 2]))
        blocks.push(top)
      }
      const median = [...blocks].sort((a, b) => a - b)[blocks.length >> 1]
      return { ratio: Math.max(...blocks) / median, median }
    }
    // 받아 둔 구간에서 한 주파수의 크기를 잰다
    window.__toneAt = async (from, to, f) => {
      const d = await window.__captured
      const rate = window.__graph.sampleRate
      const a = Math.floor(from * rate), b = Math.floor(to * rate)
      let re = 0, im = 0
      for (let i = a; i < b; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - a)) / (b - a)), p = (2 * Math.PI * f * i) / rate
        re += d[i] * w * Math.cos(p); im += d[i] * w * Math.sin(p)
      }
      return (4 * Math.hypot(re, im)) / (b - a)
    }
    window.__stats = async () => {
      const d = await window.__captured
      let peak = 0, bad = 0, sum = 0
      for (const v of d) { if (!Number.isFinite(v)) bad += 1; else { peak = Math.max(peak, Math.abs(v)); sum += v * v } }
      return { peak, bad, rms: Math.sqrt(sum / d.length) }
    }
    // 영점 교차 사이 시간으로 음높이를 잰다
    window.__pitchRange = async (seconds) => {
      const m = window.__graph.__meter
      const rate = window.__graph.sampleRate
      const a = new Float32Array(8192)
      const pitches = []
      const end = performance.now() + seconds * 1000
      while (performance.now() < end) {
        m.getFloatTimeDomainData(a)
        const crossings = []
        for (let i = 1; i < a.length; i++) if (a[i - 1] < 0 && a[i] >= 0) crossings.push(i - 1 + a[i - 1] / (a[i - 1] - a[i]))
        if (crossings.length > 3) pitches.push(((crossings.length - 1) * rate) / (crossings.at(-1) - crossings[0]))
        await new Promise((r) => setTimeout(r, 50))
      }
      const lo = Math.min(...pitches), hi = Math.max(...pitches)
      return { lo, hi, percent: ((hi - lo) / ((hi + lo) / 2)) * 100, n: pitches.length }
    }
  } catch {}
}

;(async () => {
  const files = makeFixtures()
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
  await new Promise((r) => server.listen(4183, r))
  const url = `http://localhost:4183${BASE}`
  const browser = await chromium.launch({ channel: 'msedge' })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  await ctx.addInitScript(stub)
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) problems.push(`console: ${m.text()}`) })

  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(async (list) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('fx', { create: true })
    for (const name of list) {
      const bytes = await (await fetch(`__fx/${name}`)).arrayBuffer()
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
      await w.write(bytes); await w.close()
    }
  }, files)
  await page.getByRole('region', { name: '폴더' }).getByRole('button', { name: '폴더 추가' }).click()
  await page.waitForFunction((n) => window.__reads.read >= n, files.length, { timeout: 40000 })
  await page.waitForTimeout(500)

  const level = async () => { await page.waitForTimeout(350); return page.evaluate(() => window.__level()) }
  const harmonics = async (f = 1000) => { await page.waitForTimeout(400); return page.evaluate((v) => window.__harmonics(v), f) }
  const play = async (title) => {
    await page.evaluate(() => { location.hash = '#/folders' })
    await page.locator('main li', { hasText: 'fx' }).getByRole('link').click()
    await page.locator('main ol li').first().waitFor()
    await page.locator('main ol li', { hasText: title }).first().locator('button').first().click()
    await page.waitForFunction((t) => document.title.startsWith(`${t} - `) && !window.__audio.paused && window.__audio.currentTime > 0.1, title, { timeout: 8000 })
    await page.evaluate(() => { location.hash = '#/now-playing?tab=sound' })
    await page.getByRole('switch', { name: '원음 듣기' }).waitFor()
    await page.waitForTimeout(150)
  }
  const key = async (name, keyName, times = 1) => {
    await page.getByRole('slider', { name, exact: true }).focus()
    for (let i = 0; i < times; i++) await page.keyboard.press(keyName)
  }
  const group = (name, label) => page.locator(`label:has(input[name="${name}"])`, { hasText: new RegExp(`^${label}$`) }).click()
  const reset = async () => { await page.getByRole('button', { name: '초기화' }).click(); await page.waitForTimeout(200) }
  const touch = async () => { await key('저음', 'ArrowRight'); await key('저음', 'ArrowLeft'); await page.waitForTimeout(150) }
  const db = (v) => `${v.toFixed(1)}dB`

  // 진공관
  await play('큰 소리')
  await touch()
  const clean = await level()
  const cleanH = await harmonics()
  check('진공관 끔: 배음 없음', cleanH.h2 < -70, `2차 ${db(cleanH.h2)}`)
  await key('진공관', 'ArrowRight', 6)
  const lightH = await harmonics()
  await key('진공관', 'End')
  const fullH = await harmonics()
  const fullLevel = await level()
  check('진공관 30%: 2차 배음이 생김', lightH.h2 > -60 && lightH.h2 < -25, `2차 ${db(lightH.h2)}`)
  check('진공관 100%: 배음이 더 커짐', fullH.h2 > lightH.h2 + 5, `2차 ${db(fullH.h2)}, 3차 ${db(fullH.h3)}`)
  check('짝수 배음이 뚜렷함', fullH.h2 > fullH.h3 - 3, `2차 ${db(fullH.h2)}, 3차 ${db(fullH.h3)}, 4차 ${db(fullH.h4)}`)
  check('왜곡이 과하지 않음 (2차 -15dB 이하)', fullH.h2 < -15, db(fullH.h2))
  check('비대칭 곡선의 직류 성분 제거', Math.abs(fullLevel.mean) < 0.004, fullLevel.mean.toFixed(5))
  check('음량이 크게 변하지 않음', near(fullLevel.rms / clean.rms, 1, 0.3), x(fullLevel.rms / clean.rms))
  await play('작은 소리')
  await page.waitForTimeout(100)
  const quietH = await harmonics()
  check('작은 소리는 덜 왜곡됨 (실제 진공관처럼 크기에 따라)', quietH.h2 < fullH.h2 - 8, `작은 소리 ${db(quietH.h2)}, 큰 소리 ${db(fullH.h2)}`)
  await reset()

  // 실제 곡처럼 큰 베이스가 깔렸을 때
  await play('베이스와 고음')
  await touch()
  await key('진공관', 'End')
  await page.waitForTimeout(500)
  const [imdMain, imdLow, imdHigh] = await page.evaluate(() => window.__peaks([1000, 940, 1060]))
  check('큰 베이스 위의 고음이 찌그러지지 않음 (-30dB 이하)', Math.max(imdLow, imdHigh) - imdMain < -30, `${(Math.max(imdLow, imdHigh) - imdMain).toFixed(1)}dB`)
  await play('큰 베이스')
  await page.waitForTimeout(500)
  const [bassMain, bassSecond] = await page.evaluate(() => window.__peaks([60, 120]))
  check('큰 베이스가 윙윙거리지 않음 (2차 -50dB 이하)', bassSecond - bassMain < -50, `${(bassSecond - bassMain).toFixed(1)}dB`)
  await reset()

  // 곡선이 곡에 없던 저음을 만들지 않는지
  await play('두 음')
  await touch()
  await key('진공관', 'End')
  await page.waitForTimeout(500)
  const [pairMain, pairDifference] = await page.evaluate(() => window.__peaks([1000, 40]))
  check('두 음의 차이로 저음이 생기지 않음 (-45dB 이하)', pairDifference - pairMain < -45, `${(pairDifference - pairMain).toFixed(1)}dB`)
  await reset()

  // 앰프 모드: 배음
  const modeInput = page.locator('input[name="tube-mode"]')
  await play('큰 소리')
  await touch()
  check('진공관 끔: 앰프 모드 비활성', await modeInput.first().isDisabled())
  await key('진공관', 'End')
  await page.waitForTimeout(150)
  check('진공관 켬: 앰프 모드 활성', await modeInput.first().isEnabled())
  check('기본 모드는 트라이오드', await page.locator('input[name="tube-mode"][value="triode"]').isChecked())
  const triodeH = await harmonics()
  await group('tube-mode', '울트라리니어')
  const ultraH = await harmonics()
  check('트라이오드: 2차 배음이 우세', triodeH.h2 > triodeH.h3 + 10, `2차 ${db(triodeH.h2)}, 3차 ${db(triodeH.h3)}`)
  check('울트라리니어: 왜곡이 훨씬 적음', ultraH.h2 < triodeH.h2 - 12, `2차 ${db(ultraH.h2)}`)
  check('울트라리니어: 3차 비중이 더 큼', ultraH.h3 > ultraH.h2, `2차 ${db(ultraH.h2)}, 3차 ${db(ultraH.h3)}`)

  // 앰프 모드: 전환과 켜고 끌 때 잡음
  await group('tube-mode', '트라이오드')
  await key('진공관', 'Home')
  await key('진공관', 'ArrowRight', 10)
  await page.waitForTimeout(400)
  await page.evaluate(() => window.__capture(1.5))
  await page.waitForTimeout(450)
  await group('tube-mode', '울트라리니어')
  await page.waitForTimeout(450)
  await group('tube-mode', '트라이오드')
  const modeSpike = await page.evaluate(() => window.__spike())
  const modeTrace = await page.evaluate(async () => {
    const h2 = async (from, to) => (await window.__toneAt(from, to, 2000)) / (await window.__toneAt(from, to, 1000))
    return { triode: await h2(0.05, 0.35), ultra: await h2(0.62, 0.86) }
  })
  const traceDb = 20 * Math.log10(modeTrace.ultra / modeTrace.triode)
  check('녹음 구간 안에서 모드가 실제로 바뀜', traceDb < -8, `2차 배음 ${db(traceDb)}`)
  check('모드를 바꿔도 튀는 소리 없음', modeSpike.ratio < 3, x(modeSpike.ratio))

  // 다른 효과를 남겨서 경로는 그대로 두고 진공관만 켜고 끈다
  await key('진공관', 'Home')
  await key('저음', 'ArrowRight')
  await page.waitForTimeout(400)
  await page.evaluate(() => window.__capture(1.5))
  await page.waitForTimeout(450)
  await key('진공관', 'End')
  await page.waitForTimeout(450)
  await key('진공관', 'Home')
  const toggleSpike = await page.evaluate(() => window.__spike())
  check('진공관을 켜고 꺼도 튀는 소리 없음', toggleSpike.ratio < 3, x(toggleSpike.ratio))
  await key('진공관', 'ArrowRight', 4)
  await page.waitForTimeout(300)
  await page.evaluate(() => window.__capture(1.5))
  await page.waitForTimeout(300)
  await key('진공관', 'ArrowRight', 12)
  await page.waitForTimeout(100)
  await key('진공관', 'ArrowLeft', 12)
  const sweepSpike = await page.evaluate(() => window.__spike())
  check('슬라이더를 움직여도 튀는 소리 없음', sweepSpike.ratio < 3, x(sweepSpike.ratio))
  await key('진공관', 'Home')
  await page.waitForTimeout(300)

  // 참고: 이번 변경과 상관없이 경로가 바뀌는 순간
  await page.evaluate(() => window.__capture(1.2))
  await page.waitForTimeout(450)
  await page.getByRole('switch', { name: '원음 듣기' }).click()
  const directSpike = await page.evaluate(() => window.__spike())
  await page.getByRole('switch', { name: '원음 듣기' }).click()
  console.log(`INFO 원음 듣기를 켤 때 ${x(directSpike.ratio)}`)
  await reset()

  // 앰프 모드: 음색
  await play('작은 세 음')
  await touch()
  const tones = () => page.waitForTimeout(400).then(() => page.evaluate(() => window.__peaks([300, 1000, 10000])))
  const flat = await tones()
  const diff = (a) => a.map((v, i) => v - flat[i])
  const show = (a) => a.map((v) => v.toFixed(1)).join(' / ')
  await key('진공관', 'End')
  const triodeTone = diff(await tones())
  await key('진공관', 'Home')
  await key('진공관', 'ArrowRight', 10)
  const halfTone = diff(await tones())
  await key('진공관', 'End')
  await group('tube-mode', '울트라리니어')
  const ultraTone = diff(await tones())
  check('트라이오드: 중저역이 오르고 고역이 내려감', near(triodeTone[0], 1.5, 0.4) && near(triodeTone[2], -2.5, 0.4), `300Hz/1kHz/10kHz ${show(triodeTone)} dB`)
  check('트라이오드 50%: 음색도 절반', near(halfTone[0], triodeTone[0] / 2, 0.3) && near(halfTone[2], triodeTone[2] / 2, 0.3), `${show(halfTone)} dB`)
  check('울트라리니어: 음색이 평탄함', ultraTone.every((v) => Math.abs(v) < 0.25), `${show(ultraTone)} dB`)
  await reset()

  // 꽉 찬 실제 곡
  await play('Life Goes On')
  await touch()
  await page.evaluate(() => { window.__audio.currentTime = 43 })
  await page.waitForTimeout(600)
  for (const [mode, label] of [['트라이오드', 'triode'], ['울트라리니어', 'ultra']]) {
    await key('진공관', 'End')
    await group('tube-mode', mode)
    await page.waitForTimeout(300)
    await page.evaluate(() => window.__capture(5))
    const song = await page.evaluate(() => window.__stats())
    check(`Life Goes On ${label} 100%: 리미터 뒤 잘림 없음`, song.bad === 0 && song.rms > 0.05 && song.peak <= 1, `피크 ${song.peak.toFixed(3)}, 실효 ${song.rms.toFixed(3)}`)
  }
  await reset()

  // 슬라이더가 연결을 끊지 않는지
  await touch()
  await key('진공관', 'ArrowRight')
  await page.waitForTimeout(150)
  const before = await page.evaluate(() => window.__sourceDisconnects)
  await key('진공관', 'ArrowRight', 8)
  await group('vinyl', '약'); await group('vinyl', '강'); await group('phase', '중'); await group('phase', '강')
  await group('tube-mode', '울트라리니어'); await group('tube-mode', '트라이오드')
  check('효과를 바꿔도 오디오 연결을 끊지 않음', await page.evaluate(() => window.__sourceDisconnects) === before)
  await reset()

  // 저역 위상 보정
  await play('저역')
  await touch()
  const lowFlat = await level()
  await group('phase', '중')
  const lowPhased = await level()
  check('위상 보정: 60Hz 음량 그대로', near(lowPhased.rms / lowFlat.rms, 1, 0.03), x(lowPhased.rms / lowFlat.rms))
  await play('큰 소리')
  const midPhased = await level()
  check('위상 보정: 1kHz 음량 그대로', near(midPhased.rms / clean.rms, 1, 0.03), x(midPhased.rms / clean.rms))
  const phase = await page.evaluate(() => {
    const f = window.__allpass
    if (!f) return null
    const freqs = new Float32Array([60, 120, 1000, 5000])
    const mag = new Float32Array(4), ph = new Float32Array(4)
    f.getFrequencyResponse(freqs, mag, ph)
    return { fc: f.frequency.value, mag: [...mag].map((v) => +v.toFixed(3)), deg: [...ph].map((v) => Math.round((v * 180) / Math.PI)) }
  })
  check('위상 보정: 저역 위상이 실제로 돌고 고역은 거의 그대로', phase && phase.mag.every((m) => near(m, 1, 0.01)) && Math.abs(phase.deg[1]) > 120 && Math.abs(phase.deg[3]) < 15, JSON.stringify(phase))
  await reset()

  // 바이닐: 무음 곡으로 잡음만 잰다
  await play('무음')
  await touch()
  const silent = await level()
  check('바이닐 끔: 무음', silent.peak < 0.0005, silent.peak.toFixed(5))
  const noise = {}
  for (const [label, name] of [['약', 'light'], ['중', 'medium'], ['강', 'strong']]) {
    await group('vinyl', label)
    await page.waitForTimeout(500)
    noise[name] = await level()
  }
  check('바이닐: 강도가 올라가면 잡음도 커짐', noise.light.rms > 0 && noise.medium.rms > noise.light.rms * 1.5 && noise.strong.rms > noise.medium.rms * 1.5, `${(20 * Math.log10(noise.light.rms)).toFixed(1)} / ${(20 * Math.log10(noise.medium.rms)).toFixed(1)} / ${(20 * Math.log10(noise.strong.rms)).toFixed(1)} dBFS`)
  check('바이닐: 잡음이 음악을 가리지 않는 크기', noise.strong.rms < 0.012, `강 ${noise.strong.rms.toFixed(5)}`)
  const pops = await page.evaluate(async () => {
    const m = window.__graph.__meter
    const a = new Float32Array(8192)
    let peak = 0, sum = 0, n = 0
    for (let i = 0; i < 60; i++) {
      m.getFloatTimeDomainData(a)
      for (const v of a) { peak = Math.max(peak, Math.abs(v)); sum += v * v; n += 1 }
      await new Promise((r) => setTimeout(r, 50))
    }
    return { peak, rms: Math.sqrt(sum / n) }
  })
  check('바이닐: 틱 소리가 잔잡음보다 튐', pops.peak / pops.rms > 5, `피크/실효 ${x(pops.peak / pops.rms)}`)

  // 음악과 따로 나오는 소리가 재생 상태를 따라가는지
  await page.getByRole('button', { name: '일시정지' }).click()
  const paused = await level()
  check('일시정지하면 잡음도 멈춤', paused.peak < 0.0005, paused.peak.toFixed(5))
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await page.waitForTimeout(300)
  const resumed = await level()
  check('재생하면 잡음 복귀', resumed.rms > noise.medium.rms, resumed.rms.toFixed(5))
  await page.getByRole('slider', { name: '볼륨' }).focus()
  for (let i = 0; i < 50; i++) await page.keyboard.press('ArrowLeft')
  const halfVolume = await level()
  check('볼륨 50%면 잡음도 절반', near(halfVolume.rms / resumed.rms, 0.5, 0.12), x(halfVolume.rms / resumed.rms))
  await page.getByRole('button', { name: '음소거' }).click()
  const muted = await level()
  check('음소거하면 잡음도 꺼짐', muted.peak < 0.0005, muted.peak.toFixed(5))
  await page.getByRole('button', { name: '음소거 해제' }).click()
  await page.getByRole('slider', { name: '볼륨' }).focus()
  for (let i = 0; i < 50; i++) await page.keyboard.press('ArrowRight')
  await page.getByRole('switch', { name: '원음 듣기' }).click()
  const direct = await level()
  check('원음 듣기면 잡음도 꺼짐', direct.peak < 0.0005, direct.peak.toFixed(5))
  await page.getByRole('switch', { name: '원음 듣기' }).click()
  await group('vinyl', '끔')
  const noiseOff = await level()
  check('바이닐을 끄면 잡음 없음', noiseOff.peak < 0.0005, noiseOff.peak.toFixed(5))
  await reset()

  // 회전 흔들림과 고역
  await play('큰 소리')
  await touch()
  const right = await page.evaluate(() => window.__pitchRange(0.5))
  console.log(`INFO 경로 전환 직후 음높이 ${right.percent.toFixed(3)}%, ${right.lo.toFixed(1)}~${right.hi.toFixed(1)}Hz`)
  await page.waitForTimeout(400)
  const steady = await page.evaluate(() => window.__pitchRange(3))
  check('바이닐 끔: 음높이 일정', steady.percent < 0.02, `${steady.percent.toFixed(3)}%, ${steady.n}회`)
  const straddle = page.evaluate(() => window.__pitchRange(1.2))
  await page.waitForTimeout(400)
  await key('저음', 'ArrowRight')
  await page.waitForTimeout(350)
  await key('저음', 'ArrowLeft')
  const forced = await straddle
  console.log(`INFO 측정 중에 경로를 바꾸면 ${forced.percent.toFixed(3)}%, ${forced.lo.toFixed(1)}~${forced.hi.toFixed(1)}Hz`)
  await page.waitForTimeout(300)
  await group('vinyl', '강')
  await page.waitForTimeout(300)
  const wobble = await page.evaluate(() => window.__pitchRange(4))
  check('바이닐 강: 음높이가 미세하게 흔들림', wobble.percent > 0.1 && wobble.percent < 2, `${wobble.percent.toFixed(3)}%, ${wobble.lo.toFixed(1)}~${wobble.hi.toFixed(1)}Hz`)
  await reset()
  await play('고역')
  await touch()
  const highFlat = await level()
  await group('vinyl', '강')
  await page.waitForTimeout(400)
  const highCut = await level()
  check('바이닐: 고역이 부드럽게 줄어듦', highCut.rms / highFlat.rms < 0.75 && highCut.rms / highFlat.rms > 0.4, x(highCut.rms / highFlat.rms))
  await reset()

  // 저장
  await play('큰 소리')
  await key('진공관', 'ArrowRight', 8)
  await group('tube-mode', '울트라리니어')
  await group('vinyl', '약')
  await group('phase', '강')
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(shots, 'effects-black.jpg'), type: 'jpeg', quality: 90 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('switch', { name: '원음 듣기' }).waitFor()
  await page.waitForTimeout(300)
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('music-player:sound')))
  check('새로고침: 효과 설정 유지', near(kept.tube, 0.4, 0.001) && kept.tubeMode === 'ultralinear' && kept.vinyl === 'light' && kept.phase === 'strong', JSON.stringify({ tube: kept.tube, tubeMode: kept.tubeMode, vinyl: kept.vinyl, phase: kept.phase }))
  check('새로고침: 앰프 모드 표시 유지', await page.locator('input[name="tube-mode"][value="ultralinear"]').isChecked())
  check('새로고침: 재생 전에는 그래프 없음', await page.evaluate(() => window.__sources) === 0)
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await page.waitForFunction(() => !window.__audio.paused && window.__audio.currentTime > 0.1, null, { timeout: 5000 })
  await page.waitForTimeout(500)
  const afterReload = await page.evaluate(() => window.__harmonics(1000))
  check('새로고침 후 재생하면 효과 적용', afterReload.h3 > -90, `2차 ${db(afterReload.h2)}, 3차 ${db(afterReload.h3)}`)
  await reset()
  check('초기화: 앰프 모드도 기본값', await page.locator('input[name="tube-mode"][value="triode"]').isChecked())
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('music-player:sound'))
    localStorage.setItem('music-player:sound', JSON.stringify({ ...saved, tube: 0.5, tubeMode: 'pentode' }))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('switch', { name: '원음 듣기' }).waitFor()
  check('저장값이 이상하면 트라이오드', await page.locator('input[name="tube-mode"][value="triode"]').isChecked())
  await group('tube-mode', '울트라리니어')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(shots, 'effects-white.jpg'), type: 'jpeg', quality: 90 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(250)
  check('휴대폰: 가로 넘침 없음', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.evaluate(() => { const s = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 40 && getComputedStyle(d).overflowY === 'auto'); if (s) s.scrollTop = 760 })
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(shots, 'effects-mobile.jpg'), type: 'jpeg', quality: 90 })

  const real = problems.filter((p) => !p.includes('no supported source'))
  check('오류 없음', real.length === 0, real.slice(0, 4).join(' | '))
  await browser.close()
  server.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
