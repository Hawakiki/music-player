// 음향 3단계 검증: 고역 복원을 실제 앱에서 재생하며 잰다.
// usage: node verify8.cjs <distDir> <shotDir>
const { spawnSync } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')

const [dist, shots] = process.argv.slice(2)
const SOURCE = path.join(__dirname, '..', 'out', 'fixtures', 'restore')
const FX = path.join(__dirname, '..', 'out', 'fixtures', 'restore-app')
const BASE = '/music-player/'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` (${detail})` : ''}`) }
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance
const db = (v) => `${v.toFixed(1)}dB`

function makeFixtures() {
  fs.mkdirSync(FX, { recursive: true })
  const list = [
    ['boen-mp3-128.mp3', 'a.mp3', '압축 128'],
    ['boen-mp3-192.mp3', 'b.mp3', '압축 192'],
    ['boen-fake-flac.flac', 'c.flac', '가짜 무손실'],
    ['boen-original.flac', 'd.flac', '진짜 무손실'],
  ]
  for (const [from, to, title] of list) {
    const file = path.join(FX, to)
    if (fs.existsSync(file)) continue
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(SOURCE, from), '-c', 'copy', '-metadata', `title=${title}`, '-metadata', 'artist=측정', '-metadata', 'album=측정', file], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(r.stderr)
  }
  return fs.readdirSync(FX)
}

const stub = () => {
  try {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('fx')
    FileSystemHandle.prototype.queryPermission = async function () { return 'granted' }
    const NativeAudio = window.Audio
    window.__loads = 0
    window.Audio = function (...a) {
      const el = new NativeAudio(...a)
      window.__audio = el
      el.addEventListener('loadstart', () => { window.__loads += 1 })
      return el
    }
    window.__reads = { read: 0, unchanged: 0, unavailable: 0 }
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(...a) { super(...a); this.addEventListener('message', (e) => { window.__reads[e.data.kind] = (window.__reads[e.data.kind] ?? 0) + 1 }) }
    }
    window.__slowFile = 0
    const nativeGetFile = FileSystemFileHandle.prototype.getFile
    FileSystemFileHandle.prototype.getFile = async function () {
      if (window.__slowFile) await new Promise((r) => setTimeout(r, window.__slowFile))
      return nativeGetFile.call(this)
    }
    window.__sources = 0
    window.__sourceDisconnects = 0
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
    }
    // 재는 타이머가 도는지 본다
    window.__timers = new Set()
    const nativeSet = window.setInterval, nativeClear = window.clearInterval
    window.setInterval = (fn, ms, ...a) => { const id = nativeSet(fn, ms, ...a); if (ms === 250) window.__timers.add(id); return id }
    window.clearInterval = (id) => { window.__timers.delete(id); return nativeClear(id) }

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
    window.__paramLog = []
    const setTarget = AudioParam.prototype.setTargetAtTime
    AudioParam.prototype.setTargetAtTime = function (value, start, constant) {
      window.__paramLog.push([Math.round(performance.now()), this.defaultValue, Number(value.toFixed(4)), constant])
      return setTarget.call(this, value, start, constant)
    }
    window.__bands = async (ranges, frames = 14) => {
      const m = window.__graph.__meter
      const data = new Float32Array(m.frequencyBinCount)
      const hz = window.__graph.sampleRate / m.fftSize
      const sums = ranges.map(() => 0)
      for (let i = 0; i < frames; i++) {
        m.getFloatFrequencyData(data)
        ranges.forEach(([from, to], k) => {
          let sum = 0, n = 0
          for (let b = Math.round(from / hz); b <= Math.round(to / hz); b++) { if (Number.isFinite(data[b])) sum += 10 ** (data[b] / 10); n++ }
          sums[k] += sum / n
        })
        await new Promise((r) => setTimeout(r, 90))
      }
      return sums.map((v) => 10 * Math.log10(v / frames + 1e-30))
    }
    window.__peak = async (seconds) => {
      const m = window.__graph.__meter
      const a = new Float32Array(m.fftSize)
      let peak = 0, bad = 0
      const end = performance.now() + seconds * 1000
      while (performance.now() < end) {
        m.getFloatTimeDomainData(a)
        for (const v of a) { if (!Number.isFinite(v)) bad += 1; else peak = Math.max(peak, Math.abs(v)) }
        await new Promise((r) => setTimeout(r, 40))
      }
      return { peak, bad }
    }
  } catch {}
}

;(async () => {
  const files = makeFixtures()
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
  await new Promise((r) => server.listen(4188, r))
  const browser = await chromium.launch({ channel: 'msedge' })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  await ctx.addInitScript(stub)
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) problems.push(`console: ${m.text()}`) })

  await page.goto(`http://localhost:4188${BASE}`, { waitUntil: 'networkidle' })
  await page.evaluate(async (list) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('fx', { create: true })
    for (const name of list) {
      const bytes = await (await fetch(`__fx/${name}`)).arrayBuffer()
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
      await w.write(bytes); await w.close()
    }
  }, files)
  await page.getByRole('region', { name: '폴더' }).getByRole('button', { name: '폴더 추가' }).click()
  await page.waitForFunction((n) => window.__reads.read >= n, files.length, { timeout: 30000 })
  await page.waitForTimeout(500)

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
  const hint = () => page.locator('span.block', { hasText: /^고역 복원$/ }).locator('xpath=following-sibling::span').innerText()
  const waitHint = async (pattern, ms) => {
    const end = Date.now() + ms
    let text = ''
    while (Date.now() < end) {
      text = await hint()
      if (pattern.test(text)) return text
      await page.waitForTimeout(100)
    }
    return text
  }
  const bands = (ranges) => page.evaluate((r) => window.__bands(r), ranges)
  const cutoffOf = (text) => Number(/([\d.]+) kHz/.exec(text)?.[1])
  const timers = () => page.evaluate(() => window.__timers.size)
  const ACTIVE = /kHz 위를 채우는 중/
  const LIGHT_DB = -6
  const STRONG_DB = Number(process.env.STRONG_DB ?? 4)
  const AIR = [17500, 19500]
  const BODY = [13000, 15000]

  // 압축 음원
  await play('압축 128')
  await touch()
  check('꺼져 있으면 설명만 보임', (await hint()) === '잘린 고역을 추정해서 채움', await hint())
  check('꺼져 있으면 재지 않음', (await timers()) === 0)
  const [offAir, offBody] = await bands([AIR, BODY])
  check('압축 음원: 잘린 위쪽이 비어 있음', offBody - offAir > 25, `위 ${db(offAir)}, 아래 ${db(offBody)}`)
  await group('restore', '중')
  check('켜면 잘린 지점을 찾음', (await hint()) === '잘린 지점을 찾는 중', await hint())
  check('켜면 재기 시작', (await timers()) === 1)
  const started = Date.now()
  const found = await waitHint(ACTIVE, 9000)
  const cutoff = cutoffOf(found)
  check('압축 128: 잘린 지점을 찾음', cutoff >= 15.5 && cutoff <= 17.5, `${found}, ${((Date.now() - started) / 1000).toFixed(1)}초`)
  await page.waitForTimeout(1500)
  const [onAir, onBody] = await bands([AIR, BODY])
  check('압축 128: 비어 있던 대역이 채워짐', onAir - offAir > 20, `${db(offAir)} -> ${db(onAir)}`)

  // 곡은 구간마다 고역이 달라서, 레벨 차이만 보려면 같은 구간을 다시 틀어 재야 한다.
  const marks = []
  const section = async (label) => {
    marks.push([await page.evaluate(() => performance.now()), label, await hint()])
    await group('restore', label)
    await page.waitForTimeout(1300)
    await page.evaluate(() => { window.__audio.currentTime = 12 })
    await page.waitForTimeout(800)
    const [air] = await bands([AIR])
    return air
  }
  if (process.env.DEBUG_STRENGTH) {
    const begin = await page.evaluate(() => { window.__paramLog.length = 0; return performance.now() })
    for (const label of ['중', '약', '중', '약', '중', '약', '중', '강', '중']) {
      const air = await section(label)
      const at = await page.evaluate(() => performance.now())
      console.log(`INFO ${label} AIR ${air.toFixed(1)} t=${((at - begin) / 1000).toFixed(1)} ${await hint()}`)
    }
    const log = await page.evaluate(() => window.__paramLog)
    for (const [time, kind, value, constant] of log) {
      if (kind === 440 || kind === 1) console.log(`INFO param t=${((time - begin) / 1000).toFixed(2)} ${kind === 440 ? 'shift' : 'gain'} ${value} tc=${constant}`)
    }
  }

  // 크기는 곡의 장기 평균을 따라가서 시간이 지나면 조금씩 움직인다. 앞뒤의 중 값으로 그 움직임을 지운다.
  const logStart = await page.evaluate(() => { window.__paramLog.length = 0; return performance.now() })
  const medium1 = await section('중')
  const light = await section('약')
  const medium2 = await section('중')
  const strong = await section('강')
  const medium3 = await section('중')
  const lightStep = light - (medium1 + medium2) / 2
  const strongStep = strong - (medium2 + medium3) / 2
  const steps = `약 ${db(lightStep)}, 강 ${db(strongStep)}, 중의 움직임 ${db(medium2 - medium1)}, ${db(medium3 - medium2)}`
  const strengthOk = near(lightStep, LIGHT_DB, 1.2) && near(strongStep, STRONG_DB, 1.2)
  check('강도 순서: 약 < 중 < 강', strengthOk, steps)
  if (!strengthOk || process.env.DEBUG_STRENGTH) {
    const values = { 중1: medium1, 약: light, 중2: medium2, 강: strong, 중3: medium3 }
    console.log(`INFO AIR ${Object.entries(values).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`)
    for (const [time, label, text] of marks) console.log(`INFO mark t=${((time - logStart) / 1000).toFixed(2)} ${label} (${text})`)
    const log = await page.evaluate(() => window.__paramLog)
    for (const [time, kind, value, constant] of log) {
      if (kind === 440 || kind === 1) console.log(`INFO param t=${((time - logStart) / 1000).toFixed(2)} ${kind === 440 ? 'shift' : 'gain'} ${value} tc=${constant}`)
    }
  }
  const medium = onAir - onBody
  await group('restore', '강')
  await page.waitForTimeout(1300)
  const loud = await page.evaluate(() => window.__peak(2.5))
  check('강: 리미터 뒤 피크가 1을 넘지 않음', loud.bad === 0 && loud.peak <= 1, loud.peak.toFixed(3))
  await group('restore', '중')
  await page.waitForTimeout(1000)

  // 멈춤과 원음 듣기
  await page.getByRole('button', { name: '일시정지' }).click()
  await page.waitForTimeout(300)
  check('일시정지하면 재기를 멈춤', (await timers()) === 0)
  check('일시정지해도 찾은 값은 유지', ACTIVE.test(await hint()), await hint())
  const stopped = await page.evaluate(() => window.__peak(0.4))
  check('일시정지 중에는 소리가 없음', stopped.peak < 0.001, stopped.peak.toFixed(5))
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await page.waitForTimeout(600)
  check('다시 재생하면 재기 시작', (await timers()) === 1)
  await page.getByRole('switch', { name: '원음 듣기' }).click()
  await page.waitForTimeout(500)
  const [directAir] = await bands([AIR])
  check('원음 듣기: 채운 대역이 사라짐', directAir < onAir - 30, `${db(onAir)} -> ${db(directAir)}`)
  check('원음 듣기: 재기를 멈춤', (await timers()) === 0)
  await page.getByRole('switch', { name: '원음 듣기' }).click()
  await page.waitForTimeout(1500)
  const [backAir, backBody] = await bands([AIR, BODY])
  check('원음 듣기를 끄면 같은 크기로 복귀', near(backAir - backBody, medium, 6), `아래 대역과의 차이 ${db(medium)} -> ${db(backAir - backBody)}`)

  // 효과를 바꿔도 연결을 끊지 않는지
  await key('저음', 'ArrowRight')
  await page.waitForTimeout(150)
  const before = await page.evaluate(() => window.__sourceDisconnects)
  await group('restore', '약'); await group('restore', '강'); await group('restore', '끔'); await group('restore', '중')
  check('강도를 바꿔도 오디오 연결을 끊지 않음', (await page.evaluate(() => window.__sourceDisconnects)) === before)
  await key('저음', 'ArrowLeft')
  await page.waitForTimeout(200)

  // 곡이 바뀌면 다시 잼
  await play('압축 192')
  check('곡이 바뀌면 다시 찾음', (await hint()) === '잘린 지점을 찾는 중', await hint())
  const TOP = [19800, 21500]
  const [freshTop] = await bands([TOP])
  const found192 = await waitHint(ACTIVE, 9000)
  check('압축 192: 더 높은 지점을 찾음', cutoffOf(found192) >= 18 && cutoffOf(found192) <= 19.5, found192)
  await page.waitForTimeout(1500)
  const [filledTop] = await bands([TOP])
  check('찾기 전에는 앞 곡의 값으로 채우지 않음', filledTop - freshTop > 12, `${db(freshTop)} -> ${db(filledTop)}`)

  // 새 파일을 읽는 동안 앞 곡이 계속 나와도 분석에 섞이지 않는지
  const slowSwitch = async (title, ms) => {
    const loads = await page.evaluate((v) => { window.__slowFile = v; return window.__loads }, ms)
    await play(title)
    await page.waitForFunction((n) => window.__loads > n, loads, { timeout: 5000 })
    await page.evaluate(() => { window.__slowFile = 0 })
    await page.waitForTimeout(100)
    const during = await hint()
    return `${during} / ${await waitHint(ACTIVE, 9000)}`
  }
  for (const [title, low, high] of [['압축 128', 15.5, 17.5], ['압축 192', 18, 19.5], ['가짜 무손실', 15.5, 17.5]]) {
    for (const ms of [300, 1200]) {
      await page.waitForTimeout(800)
      const text = await slowSwitch(title, ms)
      await page.waitForTimeout(1500)
      const later = await hint()
      check(`느린 전환 ${ms}ms: ${title} 값이 맞음`, cutoffOf(later) >= low && cutoffOf(later) <= high, `${text} -> ${later}`)
    }
  }

  // 포장만 무손실
  await play('가짜 무손실')
  const fake = await waitHint(ACTIVE, 9000)
  check('MP3를 포장한 FLAC도 잘린 지점을 찾음', cutoffOf(fake) >= 15.5 && cutoffOf(fake) <= 17.5, fake)

  // 진짜 무손실
  await play('진짜 무손실')
  await page.waitForTimeout(4500)
  check('진짜 FLAC: 판단 전에는 찾는 중', (await hint()) === '잘린 지점을 찾는 중', await hint())
  const none = await waitHint(/잘린 고역이 없는 곡/, 9000)
  check('진짜 FLAC: 잘린 고역 없음', none === '잘린 고역이 없는 곡', none)
  await reset()
  check('초기화: 고역 복원도 꺼짐', await page.locator('input[name="restore"][value="off"]').isChecked())

  // 다른 효과와 함께
  await play('압축 128')
  await key('진공관', 'End')
  await group('vinyl', '약')
  await group('restore', '강')
  await waitHint(ACTIVE, 9000)
  await page.waitForTimeout(800)
  const stacked = await page.evaluate(() => window.__peak(2))
  check('진공관, 바이닐과 함께 써도 안전', stacked.bad === 0 && stacked.peak <= 1, stacked.peak.toFixed(3))
  await page.screenshot({ path: path.join(shots, 'restore-black.jpg'), type: 'jpeg', quality: 90 })
  await reset()

  // 저장
  await group('restore', '약')
  await page.waitForTimeout(200)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('switch', { name: '원음 듣기' }).waitFor()
  await page.waitForTimeout(300)
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('music-player:sound')))
  check('새로고침: 설정 유지', kept.restore === 'light', kept.restore)
  check('새로고침: 찾은 값은 저장하지 않음', !Object.keys(kept).some((k) => /status|cutoff/i.test(k)), Object.keys(kept).join(','))
  check('새로고침: 재생 전에는 그래프 없음', (await page.evaluate(() => window.__sources)) === 0)
  check('새로고침: 재생 전에는 재지 않음', (await timers()) === 0)
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await page.waitForFunction(() => !window.__audio.paused && window.__audio.currentTime > 0.1, null, { timeout: 5000 })
  const afterReload = await waitHint(ACTIVE, 9000)
  check('새로고침 후 재생해도 찾음', ACTIVE.test(afterReload), afterReload)
  await page.getByRole('button', { name: '일시정지' }).click()
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('music-player:sound'))
    localStorage.setItem('music-player:sound', JSON.stringify({ ...saved, restore: 'maximum' }))
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('switch', { name: '원음 듣기' }).waitFor()
  check('저장값이 이상하면 꺼짐', await page.locator('input[name="restore"][value="off"]').isChecked())

  await group('restore', '중')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(shots, 'restore-white.jpg'), type: 'jpeg', quality: 90 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(250)
  check('휴대폰: 가로 넘침 없음', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.evaluate(() => { const s = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 40 && getComputedStyle(d).overflowY === 'auto'); if (s) s.scrollTop = 820 })
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(shots, 'restore-mobile.jpg'), type: 'jpeg', quality: 90 })

  const real = problems.filter((p) => !p.includes('no supported source'))
  check('오류 없음', real.length === 0, real.slice(0, 4).join(' | '))
  await browser.close()
  server.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
