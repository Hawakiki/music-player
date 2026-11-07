// 표지 색 배경, 앨범 카드 재생 버튼, 곡이 바뀔 때 표지 전환을 실제 곡으로 시험한다.
// usage: node verify16.cjs <distDir> <shotDir> <songFolder> [desktop|phone] [dark|light]
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')

const [dist, shots, songFolder, device = 'desktop', scheme = 'dark'] = process.argv.slice(2)
const LIB = path.join(__dirname, '..', 'out', 'fixtures', 'lib')
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'out', 'fixtures', 'manifest.json'), 'utf8'))
const SONGS = fs.readdirSync(songFolder).filter((f) => f.endsWith('.flac'))
const FILES = [...MANIFEST, ...SONGS.map((f) => `실제 곡/${f}`)]
const BASE = '/music-player/'
const PORT = Number(process.env.PORT ?? 4210)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const phone = device === 'phone'
const dark = scheme === 'dark'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` (${detail})` : ''}`) }
const hueIn = (h, from, to) => h >= from && h <= to

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
  await page.waitForFunction((n) => window.__reads.read + (window.__reads.unavailable ?? 0) >= n - 1, audioCount, { timeout: 120000 })
  await page.waitForTimeout(1500)

  const go = async (hash) => { await page.evaluate((h) => { location.hash = h }, hash); await page.waitForTimeout(500) }
  const tile = (name) => page.locator('main div.group').filter({ hasText: name }).first()
  const openAlbum = async (name) => { await go('#/albums'); await tile(name).locator('a').click(); await page.waitForTimeout(900) }
  const tint = () => page.evaluate(() => window.__tint())
  const fmt = (t) => t ? `L ${t.L.toFixed(2)} C ${t.C.toFixed(3)} h ${t.h.toFixed(0)} a ${t.alpha.toFixed(2)}` : 'none'
  const tintL = dark ? [0.25, 0.36] : [0.85, 0.95]

  // 1. 앨범 화면의 표지 색
  await openAlbum('Nothing But')
  let t = await tint()
  check('파란 표지 앨범은 파란 색이 깔림', t?.tinted && t.alpha > 0.99 && hueIn(t.h, 215, 270), fmt(t))
  check('배경 밝기가 테마에 맞음', t && t.L >= tintL[0] && t.L <= tintL[1], fmt(t))
  check('배경 채도가 상한 안', t && t.C <= (dark ? 0.052 : 0.037), fmt(t))
  await page.screenshot({ path: path.join(shots, `${device}-${scheme}-album-sinatra.png`) })
  const overflow = await page.evaluate(() => {
    const main = document.querySelector('main')
    return { doc: document.documentElement.scrollWidth - innerWidth, main: main.scrollWidth - main.clientWidth }
  })
  check('배경 때문에 가로 스크롤이 생기지 않음', overflow.doc <= 0 && overflow.main <= 0, JSON.stringify(overflow))
  await openAlbum('Ugly is')
  t = await tint()
  check('주황 표지 앨범은 주황 색이 깔림', t?.tinted && hueIn(t.h, 25, 75), fmt(t))
  await openAlbum('Travelling')
  t = await tint()
  check('파란 배경에 노란 카드인 표지는 넓은 파랑을 고름', t?.tinted && hueIn(t.h, 215, 275), fmt(t))
  await openAlbum('Pale Machine')
  t = await tint()
  check('색이 거의 없는 표지는 색을 깔지 않음', t && !t.tinted && t.alpha === 0, fmt(t))
  await openAlbum('무제')
  t = await tint()
  check('표지가 없는 앨범은 색을 깔지 않음', t && !t.tinted && t.alpha === 0, fmt(t))
  await openAlbum('오후 세 시')
  t = await tint()
  check('단색 표지도 색을 고름', t?.tinted, fmt(t))
  if (dark) check('어두운 테마의 노랑 계열은 상한보다 채도를 낮춤', t && t.C < 0.04, fmt(t))

  // 2. 앨범 카드 재생 버튼
  await go('#/albums')
  const playOf = (name) => tile(name).locator('button')
  const display = await playOf('Nothing But').evaluate((el) => getComputedStyle(el).display)
  if (phone) {
    const displays = await page.locator('main div.group button').evaluateAll((els) => els.map((el) => getComputedStyle(el).display))
    check('휴대폰에서는 카드 재생 버튼이 없음', displays.length > 0 && displays.every((d) => d === 'none'), displays.join(','))
    await tile('Nothing But').locator('img').first().tap()
    await page.waitForTimeout(700)
    const after = await page.evaluate(() => ({ hash: location.hash, scrollY, height: document.documentElement.scrollHeight, inner: innerHeight }))
    check('휴대폰에서 표지를 탭하면 앨범으로 들어감', after.hash.includes('/albums/'), after.hash)
    check('탭한 뒤에도 화면이 밀리지 않음', after.scrollY === 0 && after.height <= after.inner, JSON.stringify(after))
    await page.getByRole('button', { name: '재생', exact: true }).first().tap()
    await page.waitForFunction(() => window.__audio && !window.__audio.paused, null, { timeout: 15000 })
  } else {
    check('데스크톱에서는 카드 재생 버튼이 있음', display === 'grid', display)
    await page.mouse.move(5, 895)
    await page.waitForTimeout(300)
    const hidden = await playOf('Nothing But').evaluate((el) => Number(getComputedStyle(el).opacity))
    check('마우스를 올리기 전에는 버튼이 안 보임', hidden === 0, hidden)
    await tile('Nothing But').locator('img').first().hover()
    await page.waitForTimeout(400)
    const shown = await playOf('Nothing But').evaluate((el) => Number(getComputedStyle(el).opacity))
    check('마우스를 올리면 버튼이 보임', shown === 1, shown)
    const box = await tile('Nothing But').boundingBox()
    await page.screenshot({ path: path.join(shots, `${device}-${scheme}-tile-hover.png`), clip: { x: box.x - 220, y: box.y - 10, width: box.width + 440, height: box.height + 20 } })
    const hashBefore = await page.evaluate(() => location.hash)
    await playOf('Nothing But').click()
    await page.waitForFunction(() => window.__audio && !window.__audio.paused && window.__audio.currentTime > 0.2, null, { timeout: 15000 })
    const state = await page.evaluate(() => ({ hash: location.hash, title: document.title }))
    check('카드 버튼을 누르면 앨범으로 들어가지 않고 바로 재생', state.hash === hashBefore && state.title.includes('My Way'), JSON.stringify(state))
    const label = await playOf('Nothing But').getAttribute('aria-label')
    check('재생 중인 앨범의 버튼은 일시정지', label.endsWith('일시정지'), label)
    const badgeHover = await tile('Nothing But').locator('[aria-label="재생 중"]').evaluate((el) => Number(getComputedStyle(el.parentElement).opacity))
    check('마우스를 올린 동안 재생 중 표시는 버튼에 자리를 내줌', badgeHover === 0, badgeHover)
    await playOf('Nothing But').click()
    await page.waitForTimeout(300)
    check('일시정지 버튼을 누르면 멈춤', await page.evaluate(() => window.__audio.paused))
    check('멈추면 다시 재생 버튼', (await playOf('Nothing But').getAttribute('aria-label')).endsWith('재생'))
    await playOf('Nothing But').click()
    await page.waitForFunction(() => !window.__audio.paused, null, { timeout: 5000 })
    check('다시 누르면 이어서 재생', await page.evaluate(() => !window.__audio.paused && window.__audio.currentTime > 0.2))
    await page.mouse.move(5, 895)
    await page.waitForTimeout(400)
    const badge = await tile('Nothing But').locator('[aria-label="재생 중"]').evaluate((el) => Number(getComputedStyle(el.parentElement).opacity))
    await tile('Nothing But').locator('img').first().hover()
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(shots, `${device}-${scheme}-tile-hover-playing.png`), clip: { x: box.x - 220, y: box.y - 10, width: box.width + 440, height: box.height + 20 } })
    await page.mouse.move(5, 895)
    check('마우스를 떼면 재생 중 표시가 돌아옴', badge === 1, badge)
    await tile('Ugly is').locator('a').focus()
    await page.keyboard.press('Tab')
    await page.waitForTimeout(400)
    const focused = await page.evaluate(() => ({ label: document.activeElement.getAttribute('aria-label'), opacity: Number(getComputedStyle(document.activeElement).opacity) }))
    check('키보드로 가면 버튼이 보임', focused.label?.startsWith('Ugly is') && focused.opacity === 1, JSON.stringify(focused))
  }

  // 3. 재생 화면: 표지 색과 곡이 바뀔 때 전환
  await openAlbum('Ugly is')
  await page.getByRole('button', { name: /^더 보기: Ugly is/ }).first().click()
  await page.getByRole('menuitem', { name: '다음에 재생' }).click()
  await page.waitForTimeout(300)
  await go('#/now-playing')
  await page.waitForTimeout(1200)
  const start = await tint()
  check('재생 화면에도 표지 색이 깔림', start?.tinted && hueIn(start.h, 215, 270), fmt(start))
  const openFade = await page.locator('main h1').evaluate((el) => getComputedStyle(el.parentElement).animationName)
  check('재생 화면을 열 때는 제목이 나타나는 효과 없음', openFade === 'none', openFade)
  let layers = await page.evaluate(() => window.__layers())
  check('평소에는 표지가 한 장', layers?.length === 1 && layers[0].loaded > 0, JSON.stringify(layers))
  await page.screenshot({ path: path.join(shots, `${device}-${scheme}-now-before.png`) })

  await page.getByRole('button', { name: '다음 곡' }).first().click()
  const samples = []
  const begin = Date.now()
  while (Date.now() - begin < 1100) {
    samples.push({ ms: Date.now() - begin, layers: await page.evaluate(() => window.__layers()), tint: await tint() })
    await page.waitForTimeout(40)
  }
  const twoLayers = samples.filter((s) => s.layers?.length === 2)
  const fading = twoLayers.filter((s) => s.layers[1].opacity > 0.05 && s.layers[1].opacity < 0.95)
  check('곡이 바뀌면 새 표지가 앞 표지 위로 겹쳐 나타남', fading.length >= 1, `겹친 순간 ${twoLayers.length}번, 중간 투명도 ${fading.map((s) => s.layers[1].opacity.toFixed(2)).join(',')}`)
  const bottomKept = twoLayers.every((s) => s.layers[0].loaded > 0 && s.layers[0].opacity === 1)
  check('겹치는 동안 앞 표지가 밑에 그대로 있음', twoLayers.length > 0 && bottomKept)
  const end = await tint()
  check('바뀐 뒤 주황 색으로 바뀜', end?.tinted && hueIn(end.h, 25, 75), fmt(end))
  const middle = samples.filter((s) => s.tint && s.ms > 80 && s.ms < 600).map((s) => s.tint)
  const between = middle.some((m) => Math.hypot(m.L - start.L, m.C - start.C, (m.h - start.h) / 400) > 0.01 && Math.hypot(m.L - end.L, m.C - end.C, (m.h - end.h) / 400) > 0.01)
  check('배경 색이 한 번에 바뀌지 않고 서서히 바뀜', between, middle.slice(0, 4).map(fmt).join(' / '))
  layers = await page.evaluate(() => window.__layers())
  check('전환이 끝나면 다시 한 장', layers?.length === 1 && layers[0].loaded > 0, JSON.stringify(layers?.map((l) => l.opacity)))
  const titleFade = await page.locator('main h1').evaluate((el) => getComputedStyle(el.parentElement).animationName)
  check('제목도 짧게 나타남', titleFade && titleFade !== 'none', titleFade)
  await page.screenshot({ path: path.join(shots, `${device}-${scheme}-now-after.png`) })

  // 빠르게 여러 번 바꿔도 마지막 곡의 표지가 남는다
  await page.getByRole('button', { name: '이전 곡' }).first().click()
  await page.waitForTimeout(60)
  await page.getByRole('button', { name: '다음 곡' }).first().click()
  await page.waitForTimeout(60)
  await page.getByRole('button', { name: '이전 곡' }).first().click()
  await page.waitForTimeout(1500)
  layers = await page.evaluate(() => window.__layers())
  const now = await page.evaluate(() => document.title)
  t = await tint()
  check('빠르게 바꿔도 끝나면 표지 한 장', layers?.length === 1 && layers[0].loaded > 0, JSON.stringify(layers?.map((l) => l.opacity)))
  check('빠르게 바꾼 뒤 마지막 곡의 색', now.includes('My Way') && hueIn(t.h, 215, 270), `${now}, ${fmt(t)}`)

  // 움직임 줄이기: 겹치지 않고 바로 바뀐다
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: '다음 곡' }).first().click()
  const reduced = []
  const reducedBegin = Date.now()
  while (Date.now() - reducedBegin < 700) {
    reduced.push((await page.evaluate(() => window.__layers()))?.length ?? 0)
    await page.waitForTimeout(30)
  }
  const reducedTint = await tint()
  check('움직임을 줄이면 표지를 겹치지 않음', Math.max(...reduced) === 1, reduced.join(''))
  check('움직임을 줄여도 바뀐 곡의 색', reducedTint?.tinted && hueIn(reducedTint.h, 25, 75), fmt(reducedTint))
  await page.getByRole('button', { name: '이전 곡' }).first().click()
  await page.waitForTimeout(800)
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  // 표지가 안 보이는 표시에서는 색을 빼고, 돌아오면 다시 깐다
  await go('#/settings')
  await page.locator('label:has(input[name="cover-view"])', { hasText: 'VU 미터' }).click()
  await go('#/now-playing')
  await page.waitForTimeout(1000)
  t = await tint()
  check('VU 미터에서는 표지 색을 깔지 않음', t && !t.tinted && t.alpha === 0, fmt(t))
  await go('#/settings')
  await page.locator('label:has(input[name="cover-view"])', { hasText: 'LP' }).click()
  await go('#/now-playing')
  await page.waitForTimeout(1000)
  t = await tint()
  check('LP는 표지를 쓰므로 색을 깖', t?.tinted, fmt(t))
  await go('#/settings')
  await page.locator('label:has(input[name="cover-view"])', { hasText: '앨범 표지' }).click()

  if (phone) {
    await go('#/now-playing')
    await page.waitForTimeout(800)
    const metrics = await page.evaluate(() => ({ docW: document.documentElement.scrollWidth, inner: innerWidth }))
    check('휴대폰 재생 화면에 가로 넘침 없음', metrics.docW <= metrics.inner, JSON.stringify(metrics))
    await page.screenshot({ path: path.join(shots, `${device}-${scheme}-now-phone.png`) })
  }

  check('오류 없음', problems.length === 0, problems.slice(0, 3).join(' | '))
  console.log(`${pass} passed, ${fail} failed`)
  await browser.close()
  server.close()
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e.message.split('\n').slice(0, 3).join(' ')); process.exit(1) })
