// 카세트 라벨의 테이프 규격: 흔치 않은 규격의 파일은 TYPE III(FeCr)로 찍고, 실제로 재생되는지 본다.
// usage: node verify18.cjs <distDir> <shotDir> <tapeFolder> [desktop|phone] [dark|light]
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
  const browser = await chromium.launch({ channel: 'msedge' })
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
  const audioCount = FILES.filter((f) => !f.endsWith('.jpg')).length
  if (phone) await page.evaluate(() => { location.hash = '#/folders' })
  await page.getByRole('button', { name: '폴더 추가' }).first().click()
  await page.waitForFunction((n) => window.__reads.read + (window.__reads.unavailable ?? 0) >= n, audioCount, { timeout: 120000 })
  await page.waitForTimeout(1500)

  const go = async (hash) => { await page.evaluate((h) => { location.hash = h }, hash); await page.waitForTimeout(500) }
  const EXPECTED = [
    ['보통 MP3', 'TYPE I '],
    ['보통 Opus', 'TYPE I '],
    ['CD FLAC', 'TYPE II '],
    ['고해상도 FLAC', 'TYPE IV '],
    ['모노 MP3', 'TYPE I '],
    ['5.1 FLAC', 'TYPE III '],
    ['22kHz MP3', 'TYPE III '],
    ['8bit WAV', 'TYPE III '],
    ['32bit float WAV', 'TYPE III '],
    ['384kHz FLAC', 'TYPE III '],
    ['AAC 스트림', 'TYPE III '],
    ['Ogg 오디오', 'TYPE III '],
  ]
  await go('#/settings')
  await page.locator('label:has(input[name="cover-view"])', { hasText: '카세트' }).click()
  await go('#/albums')
  await page.locator('main div.group').filter({ hasText: 'Format Test' }).first().locator('a').click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '재생', exact: true }).first().click()
  await go('#/now-playing')
  for (const [index, [title, prefix]] of EXPECTED.entries()) {
    await page.waitForFunction((t) => document.title.startsWith(t), title, { timeout: 10000 }).catch(() => {})
    const playing = await page.waitForFunction(() => !window.__audio.paused && window.__audio.currentTime > 0.6, null, { timeout: 10000 }).then(() => true, () => false)
    const type = (await page.locator('[data-type]').textContent()).trim()
    const shown = await page.evaluate(() => document.title)
    check(`${title}: 실제로 재생됨`, playing && shown.startsWith(title), `${shown}, ${await page.evaluate(() => window.__audio.currentTime.toFixed(2))}초`)
    check(`${title}: ${prefix.trim()}`, type.startsWith(prefix), type)
    if (title === '5.1 FLAC' || title === '모노 MP3') {
      await page.locator('[aria-label="카세트"]').screenshot({ path: path.join(shots, `${device}-${scheme}-tape-${index + 1}.png`) })
    }
    if (index < EXPECTED.length - 1) await page.getByRole('button', { name: '다음 곡' }).first().click()
  }
  // WebM 오디오는 앨범 태그를 못 읽어 폴더 이름 앨범으로 묶인다
  await go('#/albums')
  await page.locator('main div.group').filter({ hasText: '실제 곡' }).first().locator('a').click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '재생', exact: true }).first().click()
  await go('#/now-playing')
  await page.waitForFunction(() => document.title.startsWith('WebM 오디오'), null, { timeout: 10000 }).catch(() => {})
  const webmPlaying = await page.waitForFunction(() => !window.__audio.paused && window.__audio.currentTime > 0.6, null, { timeout: 10000 }).then(() => true, () => false)
  check('WebM 오디오: 실제로 재생됨', webmPlaying && (await page.evaluate(() => document.title)).startsWith('WebM 오디오'), await page.evaluate(() => document.title))
  const webmType = (await page.locator('[data-type]').textContent()).trim()
  check('WebM 오디오(.weba): TYPE III', webmType.startsWith('TYPE III '), webmType)
  const label = page.locator('[data-type]')
  const transform = await label.evaluate((el) => getComputedStyle(el).textTransform)
  check('FeCr는 화학식대로 대소문자를 지킴', (await label.textContent()).includes('FeCr') && transform !== 'uppercase', `${await label.textContent()}, ${transform}`)
  check('오류 없음', problems.length === 0, problems.slice(0, 3).join(' | '))
  console.log(`${pass} passed, ${fail} failed`)
  await browser.close()
  server.close()
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e.message.split('\n').slice(0, 3).join(' ')); process.exit(1) })
