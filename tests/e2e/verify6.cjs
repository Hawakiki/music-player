// 음향 1단계 검증: 좌우 채널을 따로 재서 효과마다 기대값과 비교한다.
// usage: node verify6.cjs <distDir> <shotDir>
const { spawnSync } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')

const [dist, shots] = process.argv.slice(2)
const FX = path.join(__dirname, '..', 'out', 'fixtures', 'sound')
const BASE = '/music-player/'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` (${detail})` : ''}`) }
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance
const x = (v) => `x${v.toFixed(2)}`

function makeFixtures() {
  fs.mkdirSync(FX, { recursive: true })
  const ff = (name, frequency, filters, tags = {}, extra = []) => {
    const file = path.join(FX, name)
    if (fs.existsSync(file)) return
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=40:sample_rate=48000`]
    if (filters) args.push('-af', filters)
    args.push(...extra)
    for (const [k, v] of Object.entries(tags)) args.push('-metadata', `${k}=${v}`)
    const r = spawnSync('ffmpeg', [...args, file], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(r.stderr)
  }
  const stereo = 'pan=stereo|c0=c0|c1=c0'
  const leftOnly = 'pan=stereo|c0=c0|c1=0*c0'
  const t = (title) => ({ title, artist: '측정', album: '측정' })
  ff('s60.flac', 60, stereo, t('저역'))
  ff('s1k.flac', 1000, stereo, t('중역'))
  ff('s12k.flac', 12000, stereo, t('고역'))
  ff('s100.flac', 100, stereo, t('100Hz'))
  ff('mono.flac', 1000, null, t('모노 파일'))
  ff('left1k.flac', 1000, leftOnly, t('왼쪽 1k'))
  ff('left100.flac', 100, leftOnly, t('왼쪽 100'))
  ff('left8k.flac', 8000, leftOnly, t('왼쪽 8k'))
  ff('loud.flac', 1000, `volume=7,${stereo}`, t('큰 소리'))
  const rg = { REPLAYGAIN_TRACK_GAIN: '-6.00 dB', REPLAYGAIN_TRACK_PEAK: '0.500000', REPLAYGAIN_ALBUM_GAIN: '-3.00 dB', REPLAYGAIN_ALBUM_PEAK: '0.600000' }
  ff('rg.flac', 1000, stereo, { ...t('태그 있음'), ...rg })
  ff('rgup.flac', 1000, stereo, { ...t('올리는 태그'), REPLAYGAIN_TRACK_GAIN: '+12.00 dB', REPLAYGAIN_TRACK_PEAK: '0.500000' })
  ff('rg.mp3', 1000, stereo, { ...t('MP3 태그'), REPLAYGAIN_TRACK_GAIN: '-6.00 dB', REPLAYGAIN_TRACK_PEAK: '0.500000' }, ['-c:a', 'libmp3lame', '-b:a', '192k', '-id3v2_version', '3'])
  return fs.readdirSync(FX)
}

const stub = () => {
  try {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('meter')
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
    const connect = AudioNode.prototype.connect
    AudioNode.prototype.connect = function (target, ...rest) {
      if (target instanceof AudioDestinationNode) {
        const c = this.context
        if (!c.__left) {
          c.__split = c.createChannelSplitter(2)
          c.__left = c.createAnalyser()
          c.__right = c.createAnalyser()
          c.__left.fftSize = c.__right.fftSize = 2048
          connect.call(c.__split, c.__left, 0)
          connect.call(c.__split, c.__right, 1)
        }
        connect.call(this, c.__split)
      }
      return connect.call(this, target, ...rest)
    }
    window.__measure = async () => {
      const c = window.__graph
      if (!c?.__left) return { l: 0, r: 0, peak: 0 }
      const a = new Float32Array(2048), b = new Float32Array(2048)
      let l = 0, r = 0, peak = 0
      const n = 14
      for (let i = 0; i < n; i++) {
        c.__left.getFloatTimeDomainData(a); c.__right.getFloatTimeDomainData(b)
        l += Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length)
        r += Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length)
        for (const v of a) peak = Math.max(peak, Math.abs(v))
        for (const v of b) peak = Math.max(peak, Math.abs(v))
        await new Promise((res) => setTimeout(res, 35))
      }
      return { l: l / n, r: r / n, peak }
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
  await new Promise((r) => server.listen(4182, r))
  const url = `http://localhost:4182${BASE}`
  const browser = await chromium.launch({ channel: 'msedge' })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  await ctx.addInitScript(stub)
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) problems.push(`console: ${m.text()}`) })

  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(async (list) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('meter', { create: true })
    for (const name of list) {
      const bytes = await (await fetch(`__fx/${name}`)).arrayBuffer()
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
      await w.write(bytes); await w.close()
    }
  }, files)
  await page.getByRole('region', { name: '폴더' }).getByRole('button', { name: '폴더 추가' }).click()
  await page.waitForFunction((n) => window.__reads.read >= n, files.length, { timeout: 20000 })
  await page.waitForTimeout(500)

  const measure = async () => { await page.waitForTimeout(350); return page.evaluate(() => window.__measure()) }
  const play = async (title) => {
    await page.evaluate(() => { location.hash = '#/folders' })
    await page.locator('main li', { hasText: 'meter' }).getByRole('link').click()
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
  const pick = (label) => page.locator('label:has(input[name="crossfeed"])', { hasText: new RegExp(`^${label}$`) }).click()
  const reset = async () => { await page.getByRole('button', { name: '초기화' }).click(); await page.waitForTimeout(150) }

  check('곡 정보에 ReplayGain 읽음', await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('music-player')
    r.onsuccess = () => { const q = r.result.transaction('tracks').objectStore('tracks').getAll(); q.onsuccess = () => { const t = q.result.find((i) => i.title === '태그 있음'); const m = q.result.find((i) => i.title === 'MP3 태그'); r.result.close(); res(t?.trackGain === -6 && t?.albumGain === -3 && t?.trackPeak === 0.5 && t?.albumPeak === 0.6 && m?.trackGain === -6 && t?.version === 3) } }
  })))

  // 기준값
  await play('중역')
  check('아무 효과 없으면 Web Audio를 거치지 않음', await page.evaluate(() => window.__sources) === 0)
  await key('저음', 'ArrowRight')
  await page.waitForTimeout(150)
  check('효과를 켜면 그래프 연결', await page.evaluate(() => window.__sources) === 1)
  await key('저음', 'ArrowLeft')
  await page.waitForTimeout(200)
  check('효과를 전부 끄면 직접 경로로 돌아감', await page.evaluate(() => window.__sourceDisconnects) >= 1)
  const base = await measure()
  check('기준 레벨 측정', near(base.l, 0.0884, 0.01) && near(base.r, 0.0884, 0.01), `L ${base.l.toFixed(4)} R ${base.r.toFixed(4)}`)

  // 리미터는 작은 소리를 건드리면 안 된다
  await key('밸런스', 'ArrowLeft'); await key('밸런스', 'ArrowRight')
  await key('스테레오 폭', 'ArrowRight'); await key('스테레오 폭', 'ArrowLeft')
  await page.locator('label', { hasText: /^모노$/ }).getByRole('switch').click()
  await page.locator('label', { hasText: /^모노$/ }).getByRole('switch').click()
  await pick('약')
  await pick('끔')
  const neutral = await measure()
  check('중립 값이면 레벨 변화 없음', near(neutral.l / base.l, 1, 0.03), x(neutral.l / base.l))
  // 곧바로 처리 경로에서 재기 위해 값이 없는 것처럼 보이는 작은 조정을 한다
  await key('고음', 'ArrowRight')
  await page.waitForTimeout(100)
  const through = await measure()
  check('리미터 경로를 거쳐도 1kHz 레벨 유지 (자동 증폭 없음)', near(through.l / base.l, 1, 0.03), x(through.l / base.l))
  await key('고음', 'ArrowLeft')

  // 슬라이더가 연결을 다시 잇지 않는지
  await key('고음', 'ArrowRight')
  await page.waitForTimeout(100)
  const before = await page.evaluate(() => window.__sourceDisconnects)
  await key('고음', 'ArrowRight', 12)
  await key('저음', 'ArrowRight', 12)
  await key('밸런스', 'ArrowRight', 5)
  check('슬라이더를 움직여도 오디오 연결을 끊지 않음', await page.evaluate(() => window.__sourceDisconnects) === before)
  await reset()

  // 톤
  await key('저음', 'End')
  await page.waitForTimeout(200)
  const midWithBass = await measure()
  check('저음을 올려도 1kHz는 그대로', near(midWithBass.l / base.l, 1, 0.08), x(midWithBass.l / base.l))
  await reset()
  await play('저역')
  await key('고음', 'ArrowRight'); await key('고음', 'ArrowLeft')
  const lowFlat = await measure()
  await key('저음', 'End')
  const lowBoost = await measure()
  check('저음 +12dB: 60Hz가 커짐', lowBoost.l / base.l > 2.8 && lowBoost.l / lowFlat.l > 2.8, x(lowBoost.l / lowFlat.l))
  await reset()
  await play('고역')
  await key('저음', 'ArrowRight'); await key('저음', 'ArrowLeft')
  const highFlat = await measure()
  await key('고음', 'End')
  const highBoost = await measure()
  check('고음 +12dB: 12kHz가 커짐', highBoost.l / highFlat.l > 2.8, x(highBoost.l / highFlat.l))
  await reset()

  // 밸런스
  await play('중역')
  await key('밸런스', 'Home')
  const hardLeft = await measure()
  check('밸런스 왼쪽 끝: 오른쪽 무음, 왼쪽 유지', hardLeft.r < 0.003 && near(hardLeft.l / base.l, 1, 0.05), `L ${x(hardLeft.l / base.l)} R ${x(hardLeft.r / base.r)}`)
  await reset()
  await key('밸런스', 'ArrowRight', 50)
  const halfRight = await measure()
  check('밸런스 오른쪽 50: 왼쪽 절반', near(halfRight.l / base.l, 0.5, 0.05) && near(halfRight.r / base.r, 1, 0.05), `L ${x(halfRight.l / base.l)} R ${x(halfRight.r / base.r)}`)
  await reset()

  // 폭과 모노
  await play('왼쪽 1k')
  await key('저음', 'ArrowRight'); await key('저음', 'ArrowLeft')
  const leftBase = await measure()
  check('왼쪽 신호 기준', leftBase.r < 0.003 && leftBase.l > 0.08, `L ${leftBase.l.toFixed(4)} R ${leftBase.r.toFixed(4)}`)
  await page.locator('label', { hasText: /^모노$/ }).getByRole('switch').click()
  const mono = await measure()
  check('모노: 좌우 같고 절반씩', near(mono.l / leftBase.l, 0.5, 0.05) && near(mono.r / leftBase.l, 0.5, 0.05), `L ${x(mono.l / leftBase.l)} R ${x(mono.r / leftBase.l)}`)
  await page.locator('label', { hasText: /^모노$/ }).getByRole('switch').click()
  await key('스테레오 폭', 'End')
  const wide = await measure()
  check('폭 200%: 왼쪽 1.5배, 오른쪽에 반대 위상 0.5', near(wide.l / leftBase.l, 1.5, 0.08) && near(wide.r / leftBase.l, 0.5, 0.05), `L ${x(wide.l / leftBase.l)} R ${x(wide.r / leftBase.l)}`)
  await key('스테레오 폭', 'Home')
  const narrow = await measure()
  check('폭 0%: 모노와 같음', near(narrow.l / leftBase.l, 0.5, 0.05), x(narrow.l / leftBase.l))
  await reset()

  // 모노 파일
  await play('모노 파일')
  await key('저음', 'ArrowRight')
  await page.waitForTimeout(150)
  const monoFile = await measure()
  check('모노 파일: 좌우 모두 소리가 남', monoFile.l > 0.05 && near(monoFile.l, monoFile.r, 0.005), `L ${monoFile.l.toFixed(4)} R ${monoFile.r.toFixed(4)}`)
  await reset()

  // 크로스피드
  await play('왼쪽 100')
  await key('저음', 'ArrowRight'); await key('저음', 'ArrowLeft')
  const l100 = await measure()
  await pick('중')
  const cf100 = await measure()
  check('크로스피드 중: 100Hz가 약 -6dB로 건너감', near(cf100.r / cf100.l, 0.5, 0.08), `R/L ${x(cf100.r / cf100.l)}, L ${x(cf100.l / l100.l)}`)
  await pick('끔')
  await play('왼쪽 8k')
  await key('저음', 'ArrowRight'); await key('저음', 'ArrowLeft')
  const l8k = await measure()
  await pick('중')
  const cf8k = await measure()
  check('크로스피드 중: 8kHz는 거의 안 건너감', cf8k.r / cf8k.l < 0.05, `R/L ${x(cf8k.r / cf8k.l)}`)
  check('크로스피드: 고역 음량 유지', near(cf8k.l / l8k.l, 1, 0.12), x(cf8k.l / l8k.l))
  await pick('끔')
  await play('100Hz')
  await key('저음', 'ArrowRight'); await key('저음', 'ArrowLeft')
  const c100 = await measure()
  await pick('강')
  const cfCenter = await measure()
  check('크로스피드: 가운데 소리 저역 음량 유지', near(cfCenter.l / c100.l, 1, 0.08), x(cfCenter.l / c100.l))
  await pick('끔')
  await reset()

  // 리미터
  await play('큰 소리')
  await key('저음', 'ArrowRight'); await key('저음', 'ArrowLeft')
  await page.evaluate(() => { location.hash = '#/now-playing?tab=eq' })
  await page.getByRole('switch', { name: '이퀄라이저 사용' }).waitFor()
  await page.getByRole('switch', { name: '이퀄라이저 사용' }).click()
  await key('1kHz', 'End')
  await page.waitForTimeout(500)
  const limited = await measure()
  check('리미터 켬: +12dB 큰 소리도 1.0 아래', limited.peak < 1.0 && limited.peak > 0.7, `피크 ${limited.peak.toFixed(3)}`)
  await page.evaluate(() => { location.hash = '#/settings' })
  await page.getByRole('switch', { name: '리미터' }).click()
  await page.waitForTimeout(500)
  const unlimited = await measure()
  check('리미터 끔: 1.0을 크게 넘음', unlimited.peak > 2.5, `피크 ${unlimited.peak.toFixed(3)}`)
  await page.getByRole('switch', { name: '리미터' }).click()
  await page.evaluate(() => { location.hash = '#/now-playing?tab=eq' })
  await page.getByRole('switch', { name: '이퀄라이저 사용' }).waitFor()
  await page.getByRole('button', { name: '초기화' }).click()
  await page.getByRole('switch', { name: '이퀄라이저 사용' }).click()

  // 음량 평준화
  const setLoudness = async (label) => {
    await page.evaluate(() => { location.hash = '#/settings' })
    await page.getByRole('heading', { name: '설정', level: 1 }).waitFor()
    await page.locator('main label', { hasText: new RegExp(`^${label}$`) }).click()
    await page.waitForTimeout(300)
  }
  await play('태그 있음')
  await setLoudness('곡 기준')
  const rgTrack = await measure()
  check('곡 기준 -6dB', near(rgTrack.l / base.l, 0.5, 0.05), x(rgTrack.l / base.l))
  await setLoudness('앨범 기준')
  const rgAlbum = await measure()
  check('앨범 기준 -3dB', near(rgAlbum.l / base.l, 0.708, 0.05), x(rgAlbum.l / base.l))
  await setLoudness('곡 기준')
  await play('MP3 태그')
  const rgMp3 = await measure()
  check('MP3 태그도 적용', near(rgMp3.l / base.l, 0.5, 0.06), x(rgMp3.l / base.l))
  await play('올리는 태그')
  const rgUp = await measure()
  check('+12dB 태그는 피크 0.5까지만 (+6dB)', near(rgUp.l / base.l, 2, 0.12), x(rgUp.l / base.l))
  await play('중역')
  const noTag = await measure()
  check('태그 없는 곡은 그대로', near(noTag.l / base.l, 1, 0.05), x(noTag.l / base.l))
  await play('태그 있음')
  const backTag = await measure()
  check('곡이 바뀌면 값도 바뀜', near(backTag.l / base.l, 0.5, 0.05), x(backTag.l / base.l))
  await setLoudness('끔')

  // 원음 듣기
  await play('중역')
  await key('고음', 'End')
  await key('밸런스', 'Home')
  const processed = await measure()
  await page.getByRole('switch', { name: '원음 듣기' }).click()
  const direct = await measure()
  check('원음 듣기: 설정을 지우지 않고 바로 원음', processed.r < 0.003 && near(direct.l / base.l, 1, 0.04) && near(direct.r / base.r, 1, 0.04), `R ${processed.r.toFixed(4)} → ${direct.r.toFixed(4)}`)
  check('값은 그대로 남음', await page.getByRole('slider', { name: '밸런스', exact: true }).inputValue() === '-1')
  await page.getByRole('switch', { name: '원음 듣기' }).click()
  const backProcessed = await measure()
  check('다시 끄면 효과 복귀', backProcessed.r < 0.003, backProcessed.r.toFixed(4))

  // 곡이 바뀌어도 유지, 저장
  await play('고역')
  check('곡이 바뀌어도 설정 유지', await page.getByRole('slider', { name: '밸런스', exact: true }).inputValue() === '-1')
  await page.getByRole('switch', { name: '원음 듣기' }).click()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('switch', { name: '원음 듣기' }).waitFor()
  await page.waitForTimeout(400)
  check('새로고침: 설정 유지', await page.getByRole('slider', { name: '밸런스', exact: true }).inputValue() === '-1')
  check('새로고침: 원음 듣기는 꺼짐', await page.getByRole('switch', { name: '원음 듣기' }).getAttribute('aria-checked') === 'false')
  check('새로고침: 재생 전에는 그래프 없음', await page.evaluate(() => window.__sources) === 0)
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await page.waitForFunction(() => !window.__audio.paused && window.__audio.currentTime > 0.1, null, { timeout: 5000 })
  await page.waitForTimeout(300)
  const restored = await measure()
  check('새로고침 후 재생하면 효과 적용', await page.evaluate(() => window.__sources) === 1 && restored.r < 0.003, `R ${restored.r.toFixed(4)}`)
  await page.screenshot({ path: path.join(shots, 'sound-black.jpg'), type: 'jpeg', quality: 90 })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(shots, 'sound-white.jpg'), type: 'jpeg', quality: 90 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await reset()
  await page.evaluate(() => window.__audio.pause())

  // 이전 버전 곡 정보는 한 번만 다시 읽기
  await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('music-player')
    r.onsuccess = () => {
      const tx = r.result.transaction('tracks', 'readwrite')
      const store = tx.objectStore('tracks')
      const q = store.getAll()
      q.onsuccess = () => { for (const item of q.result) { delete item.version; delete item.trackGain; store.put(item) } }
      tx.oncomplete = () => { r.result.close(); res() }
    }
  }))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction((n) => window.__reads.read + window.__reads.unchanged >= n, files.length, { timeout: 20000 })
  await page.waitForTimeout(500)
  const upgraded = await page.evaluate(() => window.__reads)
  check('이전 버전 곡 정보는 다시 읽음', upgraded.read === files.length, JSON.stringify(upgraded))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction((n) => window.__reads.read + window.__reads.unchanged >= n, files.length, { timeout: 20000 })
  await page.waitForTimeout(300)
  const second = await page.evaluate(() => window.__reads)
  check('두 번째부터는 다시 읽지 않음', second.read === 0 && second.unchanged === files.length, JSON.stringify(second))

  // 설정 화면, 휴대폰
  await page.evaluate(() => { location.hash = '#/settings' })
  await page.getByRole('heading', { name: '설정', level: 1 }).waitFor()
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(shots, 'settings-sound.jpg'), type: 'jpeg', quality: 90 })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => { location.hash = '#/now-playing?tab=sound' })
  await page.getByRole('switch', { name: '원음 듣기' }).waitFor()
  await page.waitForTimeout(250)
  check('휴대폰: 가로 넘침 없음', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.evaluate(() => { const s = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 40 && getComputedStyle(d).overflowY === 'auto'); if (s) s.scrollTop = 620 })
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(shots, 'sound-mobile.jpg'), type: 'jpeg', quality: 90 })

  const real = problems.filter((p) => !p.includes('no supported source'))
  check('오류 없음', real.length === 0, real.slice(0, 4).join(' | '))
  await browser.close()
  server.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
