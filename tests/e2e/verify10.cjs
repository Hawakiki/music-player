// VU 미터 검증: 바늘 규격, 정확도, 소리 무변화, 피크, 실제 곡.
// usage: node verify10.cjs <distDir> <shotDir> <songFolder>
const { spawnSync } = require('node:child_process')
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
const vu = (v) => `${v.toFixed(2)} VU`

function makeFixtures() {
  fs.mkdirSync(FX, { recursive: true })
  const run = (name, title, input, filter) => {
    const file = path.join(FX, name)
    if (fs.existsSync(file)) return
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', input]
    if (filter) args.push('-af', filter)
    args.push('-metadata', `title=${title}`, '-metadata', 'artist=측정', '-metadata', 'album=측정', '-sample_fmt', 's32', file)
    const r = spawnSync('ffmpeg', args, { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(r.stderr)
  }
  const sine = (amp, f = 1000) => `aevalsrc=${amp}*sin(2*PI*${f}*t):s=48000:d=40`
  const stereo = 'pan=stereo|c0=c0|c1=c0'
  // 실효값 -10 dBFS는 진폭 0.4472, -20 dBFS는 0.1414
  run('ref.flac', '기준 사인', sine(0.4472), stereo)
  run('small.flac', '작은 사인', sine(0.1414), stereo)
  run('left.flac', '왼쪽만', sine(0.4472), 'pan=stereo|c0=c0|c1=0*c0')
  run('mono.flac', '모노 곡', sine(0.4472), null)
  run('bass.flac', '큰 저음', sine(0.9, 100), stereo)
  run('step.flac', '켜고 끄기', 'aevalsrc=if(lt(mod(t\\,4)\\,2)\\,0\\,0.4472*sin(2*PI*1000*t)):s=48000:d=40', stereo)
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
        if (!c.__out) {
          c.__out = c.createAnalyser()
          c.__out.fftSize = 8192
          c.__out.smoothingTimeConstant = 0
        }
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
    // 바늘 각도를 눈금 위치로 되돌린다
    window.__positions = () => [...document.querySelectorAll('[data-needle]')].map((e) => {
      const angle = Number(/rotate\(([-\d.]+)/.exec(e.getAttribute('transform'))[1])
      return (angle / 42 + 1) / 2
    })
    window.__track = (ms) => new Promise((resolve) => {
      const out = []
      const start = performance.now()
      const step = (now) => {
        out.push([now - start, ...window.__positions()])
        if (now - start < ms) requestAnimationFrame(step)
        else resolve(out)
      }
      requestAnimationFrame(step)
    })
    window.__leds = () => [...document.querySelectorAll('[data-peak]')].map((e) => e.classList.contains('fill-destructive'))
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
  await new Promise((r) => server.listen(4191, r))
  const browser = await chromium.launch({ channel: 'msedge' })

  // 바늘 규격은 실제 모듈로 계산한다
  const unit = await browser.newPage()
  await unit.goto('http://localhost:5173/src/main.tsx')
  const spec = await unit.evaluate(async () => {
    const { moveNeedle, vuToPosition, getNeedleTarget } = await import('/src/lib/player/vu-meter.ts')
    const target = vuToPosition(0)
    const simulate = (rate, jitter = 0) => {
      const needle = { position: 0, velocity: 0 }
      let t = 0, rise = null, start = null, top = 0, seed = 1
      while (t < 2) {
        seed = (seed * 16807) % 2147483647
        const frame = (1 / rate) * (1 + jitter * (seed / 2147483647 - 0.5))
        moveNeedle(needle, target, frame)
        t += frame
        top = Math.max(top, needle.position)
        if (start === null && needle.position > 0.02) start = t
        if (rise === null && needle.position >= target * 0.99) rise = t
      }
      return { rise: rise * 1000, fromStart: (rise - start) * 1000, overshoot: (top / target - 1) * 100 }
    }
    const rates = Object.fromEntries([30, 60, 90, 120, 144].map((rate) => [rate, simulate(rate)]))
    return { rates, jitter: simulate(60, 0.6), zero: vuToPosition(0), minus20: vuToPosition(-20), target: getNeedleTarget(10 ** (-10 / 20), -10) }
  })
  await unit.close()
  const rises = Object.entries(spec.rates).map(([rate, r]) => `${rate}Hz ${r.rise.toFixed(0)}ms`).join(', ')
  check('규격: 어느 주사율에서도 300ms에 99%', Object.values(spec.rates).every((r) => near(r.rise, 300, 35)), rises)
  check('규격: 주사율이 달라도 속도가 같음', Math.max(...Object.values(spec.rates).map((r) => r.rise)) - Math.min(...Object.values(spec.rates).map((r) => r.rise)) < 35)
  check('규격: 프레임이 흔들려도 같음', near(spec.jitter.rise, spec.rates[60].rise, 25), `${spec.jitter.rise.toFixed(0)}ms`)
  check('규격: 오버슈트 1~1.5%', Object.values(spec.rates).every((r) => r.overshoot >= 0.9 && r.overshoot <= 1.6), Object.values(spec.rates).map((r) => `${r.overshoot.toFixed(2)}%`).join(', '))
  check('눈금: 전압 비례 (0 VU가 71%)', near(spec.zero, 0.708, 0.001) && near(spec.minus20, 0.0708, 0.001), `${spec.zero.toFixed(3)}, ${spec.minus20.toFixed(3)}`)
  check('기준 크기가 0 VU 위치', near(spec.target, spec.zero, 0.001), spec.target.toFixed(3))

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  await ctx.addInitScript(stub)
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) problems.push(`console: ${m.text()}`) })

  await page.goto(`http://localhost:4191${BASE}`, { waitUntil: 'networkidle' })
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

  const meter = page.locator('[aria-label="VU 미터"]')
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
  const key = async (name, keyName, times = 1) => {
    await page.getByRole('slider', { name, exact: true }).focus()
    for (let i = 0; i < times; i++) await page.keyboard.press(keyName)
  }
  // 바늘이 자리 잡은 뒤 평균 눈금을 읽는다
  const reading = async () => {
    await page.waitForTimeout(900)
    const track = await page.evaluate(() => window.__track(500))
    const mean = (i) => track.reduce((sum, row) => sum + row[i], 0) / track.length
    const toVu = (p) => 20 * Math.log10(Math.max(p, 1e-4)) + 3
    return { left: toVu(mean(1)), right: toVu(mean(2)), leftPosition: mean(1), rightPosition: mean(2) }
  }

  // 기본값
  await play('기준 사인')
  check('기본은 앨범 표지', (await meter.count()) === 0)
  check('기본은 그래프 없이 재생', (await page.evaluate(() => window.__sources)) === 0)
  await page.evaluate(() => { location.hash = '#/settings' })
  await page.locator('input[name="vu-reference"]').first().waitFor({ state: 'attached' })
  check('표지일 때 0 VU 기준 비활성', await page.locator('input[name="vu-reference"]').first().isDisabled())
  check('0 VU 기본값 -10', await page.locator('input[name="vu-reference"][value="-10"]').isChecked())

  // 켜기
  await setting('cover-view', 'VU 미터')
  check('VU일 때 0 VU 기준 활성', await page.locator('input[name="vu-reference"]').first().isEnabled())
  check('재생이 끊기지 않음', await page.evaluate(() => !window.__audio.paused))
  await nowPlaying()
  check('표지 자리에 VU 미터', (await meter.count()) === 1)
  check('바늘 2개', (await page.locator('[data-needle]').count()) === 2)
  const cover = await meter.boundingBox()
  check('정사각형 표지 자리', near(cover.width, cover.height, 2), `${Math.round(cover.width)}x${Math.round(cover.height)}`)

  // 소리는 그대로
  const clean = await page.evaluate(() => window.__outPeak(500))
  check('미터를 켜도 소리는 그대로', near(clean, 0.4472, 0.002), clean.toFixed(4))

  // 정확도
  const ref = await reading()
  check('-10 dBFS 사인: 0 VU', near(ref.left, 0, 0.3) && near(ref.right, 0, 0.3), `${vu(ref.left)}, ${vu(ref.right)}`)
  await play('작은 사인')
  const smallTen = await reading()
  check('-20 dBFS 사인, 기준 -10: -10 VU', near(smallTen.left, -10, 0.4), vu(smallTen.left))
  await setting('vu-reference', '-18')
  await nowPlaying()
  const smallEighteen = await reading()
  check('-20 dBFS 사인, 기준 -18: -2 VU', near(smallEighteen.left, -2, 0.4), vu(smallEighteen.left))
  await setting('vu-reference', '-14')
  await nowPlaying()
  const smallFourteen = await reading()
  check('-20 dBFS 사인, 기준 -14: -6 VU', near(smallFourteen.left, -6, 0.4), vu(smallFourteen.left))
  await setting('vu-reference', '-10')
  await play('왼쪽만')
  const left = await reading()
  check('왼쪽만 나오는 곡: 왼쪽 바늘만', near(left.left, 0, 0.4) && left.rightPosition < 0.02, `L ${vu(left.left)}, R 위치 ${left.rightPosition.toFixed(3)}`)
  await play('모노 곡')
  const mono = await reading()
  check('모노 곡: 양쪽 같음', near(mono.left, mono.right, 0.1) && near(mono.left, 0, 0.5), `${vu(mono.left)}, ${vu(mono.right)}`)

  // 실제 재생에서 바늘 움직임
  await play('켜고 끄기')
  await page.evaluate(() => { window.__audio.currentTime = 0.5 })
  const series = await page.evaluate(() => window.__track(3400))
  const on = series.findIndex((row) => row[1] > 0.02)
  const steadyRows = series.filter((row) => row[0] > series[on][0] + 1.1e3 && row[0] < series[on][0] + 1.8e3)
  const steady = steadyRows.reduce((sum, row) => sum + row[1], 0) / steadyRows.length
  const reached = series.findIndex((row, i) => i > on && row[1] >= steady * 0.99)
  const onWindow = series.filter((row) => row[0] > series[on][0] && row[0] < series[on][0] + 1.8e3)
  const top = Math.max(...onWindow.map((row) => row[1]))
  const rise = series[reached][0] - series[on][0]
  check('재생 중 상승이 계산값과 같음', near(rise, spec.rates[60].fromStart, 45), `실측 ${rise.toFixed(0)}ms, 계산 ${spec.rates[60].fromStart.toFixed(0)}ms`)
  check('재생 중 오버슈트 작음', top / steady - 1 < 0.035, `${((top / steady - 1) * 100).toFixed(2)}%`)

  // 처리와 음량을 따라가는지
  await play('기준 사인')
  await key('밸런스', 'Home')
  const panned = await reading()
  check('밸런스 왼쪽 끝: 오른쪽 바늘이 내려감', panned.rightPosition < 0.03 && near(panned.left, 0, 0.5), `L ${vu(panned.left)}, R 위치 ${panned.rightPosition.toFixed(3)}`)
  await page.getByRole('switch', { name: '원음 듣기' }).click()
  const direct = await reading()
  check('원음 듣기에서도 미터가 움직임', near(direct.right, 0, 0.5), vu(direct.right))
  await page.getByRole('switch', { name: '원음 듣기' }).click()
  await page.getByRole('button', { name: '초기화' }).click()
  check('초기화해도 VU 유지', (await meter.count()) === 1)
  await page.getByRole('slider', { name: '볼륨' }).focus()
  for (let i = 0; i < 50; i++) await page.keyboard.press('ArrowLeft')
  const half = await reading()
  check('볼륨 50%: -6 VU', near(half.left, -6, 0.6), vu(half.left))
  await page.getByRole('button', { name: '음소거' }).click()
  const muted = await reading()
  check('음소거: 바늘이 내려감', muted.leftPosition < 0.01, muted.leftPosition.toFixed(4))
  await page.getByRole('button', { name: '음소거 해제' }).click()
  await page.getByRole('slider', { name: '볼륨' }).focus()
  for (let i = 0; i < 50; i++) await page.keyboard.press('ArrowRight')

  // 피크
  await play('큰 저음')
  await page.waitForTimeout(300)
  check('0.9 사인: 피크 꺼짐', (await page.evaluate(() => window.__leds())).every((v) => !v))
  await key('저음', 'End')
  await page.waitForTimeout(500)
  check('저음 +12dB: 피크 켜짐', (await page.evaluate(() => window.__leds())).every(Boolean))
  const limited = await page.evaluate(() => window.__outPeak(800))
  check('리미터가 막아도 피크는 켜짐', limited <= 1 && (await page.evaluate(() => window.__leds())).some(Boolean), `출력 ${limited.toFixed(3)}`)
  await page.getByRole('button', { name: '초기화' }).click()
  await page.waitForTimeout(600)
  check('피크는 잠시 유지', (await page.evaluate(() => window.__leds())).some(Boolean))
  await page.waitForTimeout(1200)
  check('피크가 꺼짐', (await page.evaluate(() => window.__leds())).every((v) => !v))

  // 멈춤
  await page.getByRole('button', { name: '일시정지' }).click()
  await page.waitForTimeout(1500)
  check('일시정지: 바늘이 내려앉음', (await page.evaluate(() => window.__positions())).every((p) => p < 0.01))
  const framesBefore = await page.evaluate(() => window.__frames)
  await page.waitForTimeout(600)
  const framesAfter = await page.evaluate(() => window.__frames)
  check('멈춘 뒤에는 그리기를 쉼', framesAfter - framesBefore < 5, `${framesAfter - framesBefore}프레임`)
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await page.waitForTimeout(900)
  check('다시 재생하면 바늘이 움직임', (await page.evaluate(() => window.__positions())).every((p) => p > 0.3))

  // 실제 곡
  await play('Life Goes On')
  await page.evaluate(() => { window.__audio.currentTime = 43 })
  await page.waitForTimeout(800)
  const real = await page.evaluate(async () => {
    const leds = []
    const timer = setInterval(() => leds.push(window.__leds().some(Boolean)), 100)
    const rows = await window.__track(12000)
    clearInterval(timer)
    return { rows: rows.map((row) => row[1]), lit: leds.filter(Boolean).length / leds.length }
  })
  check('Life Goes On: 평소에는 피크가 꺼져 있음', real.lit < 0.1, `${(real.lit * 100).toFixed(1)}%`)
  const sorted = [...real.rows].sort((a, b) => a - b)
  const toVu = (p) => 20 * Math.log10(Math.max(p, 1e-4)) + 3
  const pinned = real.rows.filter((p) => p >= 1).length / real.rows.length
  check('Life Goes On: 바늘이 눈금 안에서 움직임', pinned < 0.1 && toVu(sorted[Math.floor(sorted.length * 0.9)]) - toVu(sorted[Math.floor(sorted.length * 0.1)]) > 3, `중앙값 ${vu(toVu(sorted[sorted.length >> 1]))}, 상위10% ${vu(toVu(sorted[Math.floor(sorted.length * 0.9)]))}, 끝 도달 ${(pinned * 100).toFixed(1)}%`)
  await key('저음', 'ArrowRight', 12)
  await page.waitForTimeout(400)
  const pushed = await page.evaluate(async () => {
    const leds = []
    for (let i = 0; i < 40; i++) { leds.push(window.__leds().some(Boolean)); await new Promise((r) => setTimeout(r, 100)) }
    return leds.filter(Boolean).length / leds.length
  })
  const held = await page.evaluate(() => window.__outPeak(600))
  check('Life Goes On 저음 +6dB: 피크가 켜지고 리미터가 막음', pushed > 0.3 && held <= 1.02, `점등 ${(pushed * 100).toFixed(0)}%, 출력 ${held.toFixed(3)}`)
  await page.getByRole('button', { name: '초기화' }).click()
  await page.waitForTimeout(1500)
  // 버퍼가 커도 바늘이 계단처럼 움직이지 않아야 한다
  const smooth = await page.evaluate(async () => {
    const rows = await window.__track(3000)
    const steps = rows.slice(1).map((row, i) => Math.abs(row[1] - rows[i][1]))
    const moving = steps.filter((v) => v > 0.00001).length / steps.length
    return { moving, biggest: Math.max(...steps) }
  })
  check('버퍼가 커도 바늘이 매끄럽게 움직임', smooth.moving > 0.8 && smooth.biggest < 0.12, `움직인 프레임 ${(smooth.moving * 100).toFixed(0)}%, 최대 한 번 ${smooth.biggest.toFixed(3)}`)
  await page.screenshot({ path: path.join(shots, 'vu-black.jpg'), type: 'jpeg', quality: 90 })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(shots, 'vu-white.jpg'), type: 'jpeg', quality: 90 })
  await page.emulateMedia({ colorScheme: 'dark' })

  // 저장
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('switch', { name: '원음 듣기' }).waitFor()
  await page.waitForTimeout(300)
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('music-player:sound')))
  check('새로고침: 설정 유지', kept.coverView === 'vu' && kept.vuReference === '-10', `${kept.coverView}, ${kept.vuReference}`)
  check('새로고침: VU 표시', (await meter.count()) === 1)
  check('새로고침: 재생 전에는 그래프 없음', (await page.evaluate(() => window.__sources)) === 0)
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await page.waitForFunction(() => !window.__audio.paused && window.__audio.currentTime > 0.1, null, { timeout: 6000 })
  await page.waitForTimeout(900)
  check('새로고침 후 재생하면 움직임', (await page.evaluate(() => window.__positions())).some((p) => p > 0.05), (await page.evaluate(() => window.__positions())).map((p) => p.toFixed(2)).join(', '))
  await setting('cover-view', '앨범 표지')
  await nowPlaying()
  check('앨범 표지로 돌아감', (await meter.count()) === 0)
  check('되돌려도 재생 유지', await page.evaluate(() => !window.__audio.paused))
  await page.getByRole('button', { name: '일시정지' }).click()
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('music-player:sound'))
    localStorage.setItem('music-player:sound', JSON.stringify({ ...saved, coverView: 'hologram', vuReference: '0' }))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('switch', { name: '원음 듣기' }).waitFor()
  const fallback = await page.evaluate(() => window.__sources)
  check('저장값이 이상하면 표지와 -10', (await meter.count()) === 0 && fallback === 0)

  const real2 = problems.filter((p) => !p.includes('no supported source'))
  check('오류 없음', real2.length === 0, real2.slice(0, 4).join(' | '))
  await browser.close()
  server.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
