// 받는 확장자 안에 재생할 수 없는 코덱이 든 파일은 라이브러리에 올리지 않고 제외로 센다.
// usage: node verify19.cjs <distDir> <shotDir> <codecFolder> [desktop|phone] [dark|light]  (CHANNEL=chrome이면 Chrome)
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')

const [dist, shots, songFolder, device = 'desktop', scheme = 'dark'] = process.argv.slice(2)
const LIB = path.join(__dirname, '..', 'out', 'fixtures', 'lib')
const SONGS = fs.readdirSync(songFolder)
const FILES = SONGS.map((f) => `실제 곡/${f}`)
const BASE = '/music-player/'
const PORT = Number(process.env.PORT ?? 4210)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const phone = device === 'phone'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` (${detail})` : ''}`) }

const stub = () => {
  try {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('fx')
    FileSystemHandle.prototype.queryPermission = async function () { return 'granted' }
    const NativeAudio = window.Audio
    window.Audio = function (...a) { const el = new NativeAudio(...a); window.__audio = el; return el }
    window.__reads = { read: 0 }
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(...a) { super(...a); this.addEventListener('message', (e) => { window.__reads[e.data.kind] = (window.__reads[e.data.kind] ?? 0) + 1 }) }
    }
    // 배경 색을 캔버스에 칠해 읽고 OKLCH로 바꾼다
    window.__tint = () => {
      const el = document.querySelector('[data-art-backdrop]')
      if (!el) return null
      const value = getComputedStyle(el).getPropertyValue('--art-tint').trim()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = value
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
      const [R, G, B] = [lin(r), lin(g), lin(b)]
      const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
      const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
      const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
      const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
      const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
      const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
      return { value, tinted: el.hasAttribute('data-tinted'), alpha: a / 255, L, C: Math.hypot(A, Bb), h: ((Math.atan2(Bb, A) * 180) / Math.PI + 360) % 360, rgb: [r, g, b] }
    }
    window.__layers = () => {
      const cover = document.querySelector('[data-cover]')
      if (!cover) return null
      return [...cover.children].map((c) => ({ tag: c.tagName, src: c.getAttribute('src'), opacity: Number(getComputedStyle(c).opacity), loaded: c.tagName === 'IMG' ? c.naturalWidth : -1 }))
    }
  } catch {}
}

;(async () => {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    if (!url.startsWith(BASE)) { res.writeHead(404); return res.end() }
    const rel = url.slice(BASE.length) || 'index.html'
    let file
    if (rel.startsWith('__fx/')) {
      const name = rel.slice(5)
      file = name.startsWith('실제 곡/') ? path.join(songFolder, name.slice(5)) : path.join(LIB, name)
    } else file = path.join(dist, rel)
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  fs.mkdirSync(shots, { recursive: true })
  await new Promise((r) => server.listen(PORT, r))
  const browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'msedge' })
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme }
    : { viewport: { width: 1440, height: 900 }, colorScheme: scheme })
  await ctx.addInitScript(stub)
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) problems.push(`console: ${m.text()}`) })

  await page.goto(`http://localhost:${PORT}${BASE}`, { waitUntil: 'networkidle' })
  await page.evaluate(async (files) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('fx', { create: true })
    for (const name of files) {
      const parts = name.split('/')
      let dir = root
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true })
      const bytes = await (await fetch(`__fx/${parts.map(encodeURIComponent).join('/')}`)).arrayBuffer()
      const w = await (await dir.getFileHandle(parts.at(-1), { create: true })).createWritable()
      await w.write(bytes); await w.close()
    }
  }, FILES)
  const audioCount = FILES.filter((f) => !/\.(jpg|aif|wma)$/.test(f)).length
  if (phone) await page.evaluate(() => { location.hash = '#/folders' })
  await page.getByRole('button', { name: '폴더 추가' }).first().click()
  await page.waitForFunction((n) => window.__reads.read + (window.__reads.unavailable ?? 0) >= n, audioCount, { timeout: 120000 })
  await page.waitForTimeout(1500)

  const go = async (hash) => { await page.evaluate((h) => { location.hash = h }, hash); await page.waitForTimeout(500) }
  // AC-3는 Edge만 재생한다. 앱이 브라우저에 물어서 Chrome에서는 뺀다.
  const edge = (process.env.CHANNEL ?? 'msedge') === 'msedge'
  const PLAYABLE = ['aac-in.m4b', ...(edge ? ['ac3.mka'] : []), 'flac.mka', 'mulaw.wav', 'opus.mka', 'plain.mp3', 's32.wav']
  const BLOCKED = ['adpcm.wav', 'alac.m4a', 'alac.m4b', 'alac.mka', ...(edge ? [] : ['ac3.mka']), 'dts.mka', 'f64.wav', 'gsm.wav', 'ima.wav', 'mp2.mka', 'speex.oga', 'truehd.mka']
  const SKIPPED = 2 + BLOCKED.length

  const checkLists = async (when) => {
    await go('#/folders')
    await page.waitForTimeout(600)
    const summary = await page.locator('main li').filter({ hasText: 'fx' }).first().innerText()
    check(`${when}: 폴더 설명에 재생되는 곡만 세고 나머지는 제외로 셈`, summary.includes(`${PLAYABLE.length}곡`) && summary.includes(`${SKIPPED}개 제외`), summary.replace(/\s+/g, ' '))
    if (!phone) {
      const side = await page.getByRole('link', { name: /^fx/ }).first().innerText()
      check(`${when}: 사이드바 곡 수도 같음`, side.replace(/\s+/g, ' ').endsWith(`${PLAYABLE.length}곡`), side.replace(/\s+/g, ' '))
    }
    await page.locator('main li').filter({ hasText: 'fx' }).first().getByRole('link').click()
    await page.waitForTimeout(800)
    const rows = await page.locator('main ol li').allInnerTexts()
    const titles = rows.map((row) => row.split('\n').find((line) => /\.\w+$/.test(line.trim()))?.trim())
    const leaked = BLOCKED.filter((name) => titles.includes(name))
    check(`${when}: 폴더 화면에 재생되는 곡만 보임`, rows.length === PLAYABLE.length && leaked.length === 0, `${rows.length}줄, 새어 나온 곡 ${leaked.join(',') || '없음'}`)
    await go('#/albums')
    const album = page.locator('main div.group').filter({ hasText: '실제 곡' }).first()
    await album.locator('a').click()
    await page.waitForTimeout(800)
    const albumRows = await page.locator('main ol li').count()
    check(`${when}: 앨범에도 재생되는 곡만 들어감`, albumRows === PLAYABLE.length, `${albumRows}곡`)
  }

  await checkLists('처음')

  // 앨범을 처음부터 끝까지 틀어서 남은 곡이 정말 재생되는지 본다
  await go('#/settings')
  await page.locator('label:has(input[name="cover-view"])', { hasText: '카세트' }).click()
  await go('#/albums')
  await page.locator('main div.group').filter({ hasText: '실제 곡' }).first().locator('a').click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '재생', exact: true }).first().click()
  await go('#/now-playing')
  const played = []
  for (let i = 0; i < PLAYABLE.length; i++) {
    const ok = await page.waitForFunction(() => !window.__audio.paused && window.__audio.currentTime > 0.6, null, { timeout: 10000 }).then(() => true, () => false)
    const title = (await page.evaluate(() => document.title)).replace(' - Music Player', '')
    const type = (await page.locator('[data-type]').textContent()).trim().split(' ').slice(0, 2).join(' ')
    played.push(`${title}${ok ? '' : '(멈춤)'} ${type}`)
    if (i < PLAYABLE.length - 1) {
      await page.getByRole('button', { name: '다음 곡' }).first().click()
      await page.waitForFunction((t) => !document.title.startsWith(t), title, { timeout: 10000 }).catch(() => {})
    }
  }
  check('남은 곡은 모두 실제로 재생됨', played.length === PLAYABLE.length && played.every((line) => !line.includes('(멈춤)')), played.join(' / '))
  const tapeOf = (name) => played.find((line) => line.startsWith(name))?.split(' ').slice(1).join(' ')
  const odd = PLAYABLE.filter((name) => /\.(mka|m4b)$/.test(name))
  check('mka, m4b는 TYPE III', odd.every((name) => tapeOf(name) === 'TYPE III'), odd.map((name) => `${name} ${tapeOf(name)}`).join(', '))
  check('평범한 MP3는 TYPE I', tapeOf('plain.mp3') === 'TYPE I', tapeOf('plain.mp3'))
  check('재생 실패 알림이 뜨지 않음', !(await page.getByText(/재생할 수 없/).count()), await page.getByText(/재생할 수 없/).allInnerTexts().then((t) => t.join(',')))

  // 새로고침해도 다시 읽지 않고 같은 목록이 나온다
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  await checkLists('새로고침 뒤')
  const reread = await page.evaluate(() => window.__reads.read ?? 0)
  check('새로고침 뒤에는 곡 정보를 다시 읽지 않음', reread === 0, `다시 읽은 곡 ${reread}`)
  check('오류 없음', problems.length === 0, problems.slice(0, 3).join(' | '))
  console.log(`${pass} passed, ${fail} failed`)
  await browser.close()
  server.close()
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e.message.split('\n').slice(0, 3).join(' ')); process.exit(1) })
