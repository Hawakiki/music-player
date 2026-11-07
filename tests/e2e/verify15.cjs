// 아주 긴 파일 시험. 시험용 Edge의 메모리를 감시하다가 넘치면 바로 끈다. 음악 파일은 읽기만 한다.
// usage: node verify15.cjs <distDir> <shotDir> <file>
const { exec } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')

const [dist, shots, song] = process.argv.slice(2)
const NAME = path.basename(song)
const BASE = '/music-player/'
const LIMIT_GB = 10
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` (${detail})` : ''}`) }
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance

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
    window.__decodes = 0
    const nativeDecode = BaseAudioContext.prototype.decodeAudioData
    BaseAudioContext.prototype.decodeAudioData = function (...a) {
      if (this.sampleRate === 8000) window.__decodes += 1
      return nativeDecode.apply(this, a)
    }
  } catch {}
}

function memoryGb() {
  const script = `(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*playwright*' } | Measure-Object WorkingSetSize -Sum).Sum`
  return new Promise((resolve) => {
    exec(`powershell -NoProfile -Command "${script.replaceAll('"', '\\"')}"`, { windowsHide: true }, (error, stdout) => {
      resolve(error ? 0 : Number(stdout.trim() || 0) / 1024 ** 3)
    })
  })
}

;(async () => {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    if (!url.startsWith(BASE)) { res.writeHead(404); return res.end() }
    const rel = url.slice(BASE.length) || 'index.html'
    const file = rel.startsWith('__fx/') ? song : path.join(dist, rel)
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  fs.mkdirSync(shots, { recursive: true })
  await new Promise((r) => server.listen(4196, r))
  const browser = await chromium.launch({ channel: 'msedge' })

  let peakGb = 0
  let stopped = null
  const watcher = setInterval(async () => {
    const gb = await memoryGb()
    if (gb > peakGb) peakGb = gb
    if (gb > LIMIT_GB && !stopped) {
      stopped = `메모리 ${gb.toFixed(1)}GB를 넘어서 중단`
      console.log(`STOP ${stopped}`)
      await browser.close().catch(() => {})
    }
  }, 1500)
  const finish = async (reason) => {
    clearInterval(watcher)
    console.log(`\n최대 메모리 ${peakGb.toFixed(1)}GB${reason ? `, ${reason}` : ''}`)
    console.log(`${pass} passed, ${fail} failed`)
    await browser.close().catch(() => {})
    server.close()
    process.exit(fail || reason ? 1 : 0)
  }

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  await ctx.addInitScript(stub)
  const page = await ctx.newPage()
  const problems = []
  let crashed = false
  page.on('crash', () => { crashed = true; console.log('CRASH 탭이 죽음') })
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) problems.push(`console: ${m.text()}`) })

  await page.goto(`http://localhost:4196${BASE}`, { waitUntil: 'networkidle' })
  await page.evaluate(async (name) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('fx', { create: true })
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
    await (await fetch(`__fx/${encodeURIComponent(name)}`)).body.pipeTo(w)
  }, NAME)
  console.log(`INFO 시험 파일 준비, 메모리 ${peakGb.toFixed(1)}GB`)

  const scanStart = Date.now()
  await page.getByRole('region', { name: '폴더' }).getByRole('button', { name: '폴더 추가' }).click()
  await page.waitForFunction(() => window.__reads.read >= 1, null, { timeout: 120000 })
  const scanMs = Date.now() - scanStart
  check('태그 읽기가 오래 걸리지 않음', scanMs < 15000, `${(scanMs / 1000).toFixed(1)}초`)

  await page.evaluate(() => { location.hash = '#/folders' })
  await page.locator('main li', { hasText: 'fx' }).getByRole('link').click()
  await page.locator('main ol li').first().waitFor()
  await page.waitForTimeout(1500)
  const row = (await page.locator('main ol li').first().innerText()).replaceAll('\n', ' / ')
  console.log(`INFO 목록 줄: ${row}`)
  console.log(`INFO 태그: ${JSON.stringify(await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('music-player')
    r.onsuccess = () => { const q = r.result.transaction('tracks').objectStore('tracks').getAll(); q.onsuccess = () => { const t = q.result[0]; r.result.close(); res(t ? { title: t.title, artist: t.artist, duration: t.duration, codec: t.codec, bitrate: t.bitrate, version: t.version } : null) } }
  })))}`)

  const playStart = Date.now()
  await page.locator('main ol li').first().locator('button').first().click()
  await page.waitForFunction(() => window.__audio && !window.__audio.paused && window.__audio.currentTime > 0.2, null, { timeout: 30000 })
  check('재생이 금방 시작됨', Date.now() - playStart < 5000, `${((Date.now() - playStart) / 1000).toFixed(1)}초`)
  check('길이를 정확히 앎', near(await page.evaluate(() => window.__audio.duration), 23431, 3), (await page.evaluate(() => window.__audio.duration)).toFixed(0))

  // 재생 화면: 파형을 만들려고 하는지
  await page.evaluate(() => { location.hash = '#/now-playing?tab=sound' })
  await page.getByRole('switch', { name: '원음 듣기' }).waitFor()
  const waveStart = Date.now()
  while (Date.now() - waveStart < 40000 && !crashed && !stopped) {
    await new Promise((r) => setTimeout(r, 1000))
  }
  if (crashed) return finish('탭이 죽어서 중단')
  if (stopped) return finish(stopped)
  const maxDecodes = Number(process.env.EXPECT_DECODES ?? 0)
  check(maxDecodes ? '30분 안쪽은 파형을 만듦' : '긴 곡은 곡 전체를 풀지 않음', (await page.evaluate(() => window.__decodes)) === maxDecodes, `${await page.evaluate(() => window.__decodes)}회`)
  if (maxDecodes) {
    await page.waitForFunction(() => document.querySelector('[data-testid=wave]')?.dataset.ready === 'true', null, { timeout: 60000 })
    check('파형이 표시됨', true)
    return finish()
  }
  check('메모리가 크게 늘지 않음', peakGb < 2.5, `${peakGb.toFixed(1)}GB`)
  check('재생이 계속됨', await page.evaluate(() => !window.__audio.paused))

  // 탐색
  const seek = await page.evaluate(async () => {
    const audio = window.__audio
    const begin = performance.now()
    audio.currentTime = 18000
    await new Promise((resolve) => audio.addEventListener('seeked', resolve, { once: true }))
    const seeked = performance.now() - begin
    await new Promise((r) => setTimeout(r, 2000))
    return { seeked, time: audio.currentTime, paused: audio.paused }
  })
  check('5시간 지점으로 금방 탐색', seek.seeked < 5000 && near(seek.time, 18002, 3) && !seek.paused, `${seek.seeked.toFixed(0)}ms, 위치 ${seek.time.toFixed(1)}초`)
  await page.screenshot({ path: path.join(shots, 'long-desktop.jpg'), type: 'jpeg', quality: 88 })

  // 표지 화면
  const view = async (label) => {
    await page.evaluate(() => { location.hash = '#/settings' })
    await page.locator('input[name="cover-view"]').first().waitFor({ state: 'attached' })
    await page.locator('label:has(input[name="cover-view"])', { hasText: new RegExp(`^${label}$`) }).click()
    await page.waitForTimeout(150)
    await page.evaluate(() => { location.hash = '#/now-playing?tab=sound' })
    await page.getByRole('switch', { name: '원음 듣기' }).waitFor()
    await page.waitForTimeout(900)
  }
  await view('카세트')
  const cell = (name) => page.locator(`[data-cell="${name}"]`).innerText()
  check('카세트: 스티커 길이', (await cell('time')).startsWith('6:30:3'), await cell('time'))
  await page.screenshot({ path: path.join(shots, 'long-cassette.jpg'), type: 'jpeg', quality: 88 })
  await view('LP')
  check('LP: 표시됨', (await page.locator('[aria-label="LP"]').count()) === 1)
  await view('측정')
  await page.waitForTimeout(1500)
  check('측정: 표시됨', (await page.locator('[data-scope]').count()) === 1)
  await page.screenshot({ path: path.join(shots, 'long-scope.jpg'), type: 'jpeg', quality: 88 })
  await view('앨범 표지')

  // 휴대폰 폭에서 긴 시간 표시
  await page.setViewportSize({ width: 360, height: 780 })
  await page.waitForTimeout(400)
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  check('휴대폰 폭: 넘치지 않음', fits)
  await page.evaluate(() => { location.hash = '#/folders' })
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(shots, 'long-mobile-bar.jpg'), type: 'jpeg', quality: 88 })
  await page.setViewportSize({ width: 1440, height: 900 })

  // 깊은 위치에서 복원
  await page.waitForTimeout(6000)
  const before = await page.evaluate(() => window.__audio.currentTime)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__audio?.duration > 1000, null, { timeout: 20000 })
  await page.waitForTimeout(1500)
  const restored = await page.evaluate(() => window.__audio.currentTime)
  check('새로고침 후 위치 복원', near(restored, before, 12), `${before.toFixed(0)}초 -> ${restored.toFixed(0)}초`)

  const real = problems.filter((p) => !p.includes('no supported source'))
  check('오류 없음', real.length === 0, real.slice(0, 4).join(' | '))
  await finish()
})().catch(async (e) => { console.error(e.message.split('\n')[0]); process.exit(1) })
