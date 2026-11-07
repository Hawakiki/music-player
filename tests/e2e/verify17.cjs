// LP 볼륨 노브: 지금 볼륨을 가리키고, 끌기/휠/키보드로 돌리고, 음소거와 맞물린다.
// usage: node verify17.cjs <distDir> <shotDir> <songFolder> [desktop|phone] [dark|light]
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')

const [dist, shots, songFolder, device = 'desktop', scheme = 'dark'] = process.argv.slice(2)
const LIB = path.join(__dirname, '..', 'out', 'fixtures', 'lib')
const SONGS = fs.readdirSync(songFolder).filter((f) => f.endsWith('.flac'))
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
  const tile = (name) => page.locator('main div.group').filter({ hasText: name }).first()
  await go('#/settings')
  await page.locator('label:has(input[name="cover-view"])', { hasText: 'LP' }).click()
  await go('#/albums')
  await tile('Nothing But').locator('a').click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '재생', exact: true }).first().click()
  await page.waitForFunction(() => window.__audio && !window.__audio.paused && window.__audio.currentTime > 0.3, null, { timeout: 15000 })
  await go('#/now-playing')
  await page.waitForTimeout(1500)
  const knob = page.getByRole('slider', { name: '볼륨 노브' })
  const value = () => knob.evaluate((el) => Number(el.getAttribute('aria-valuenow')))
  const angle = () => page.locator('[data-knob-cap]').evaluate((el) => {
    const m = new DOMMatrix(getComputedStyle(el).transform)
    return Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI)
  })
  const expected = (v) => Math.round(-135 + 270 * (v / 100))
  const scrollState = () => page.evaluate(() => {
    const scrollers = [...document.querySelectorAll('*')].filter((el) => el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))
    return { win: scrollY, inner: scrollers.map((el) => el.scrollTop).join(','), docW: document.documentElement.scrollWidth - innerWidth }
  })
  check('LP 화면에 볼륨 노브가 있음', (await knob.count()) === 1)
  const startValue = await value()
  check('노브가 지금 볼륨을 가리킴', startValue === 100 && (await angle()) === expected(100), `${startValue}%, ${await angle()}도`)
  const box = await knob.boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  if (!phone) {
    // 볼륨 막대로 바꾸면 노브가 따라 돈다
    const bar = page.getByRole('slider', { name: '볼륨', exact: true })
    await bar.focus()
    for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(300)
    check('볼륨 막대를 바꾸면 노브가 따라 돎', (await value()) === 40 && (await angle()) === expected(40), `${await value()}%, ${await angle()}도`)

    // 실제 노브처럼 중심을 돌며 잡아 돌린다. 270도가 끝에서 끝
    const point = (deg, r) => [cx + r * Math.sin((deg * Math.PI) / 180), cy - r * Math.cos((deg * Math.PI) / 180)]
    const turn = async (from, to, { r = 30, stepDeg = 3, press = true, release = true } = {}) => {
      if (press) {
        await page.mouse.move(...point(from, r))
        await page.mouse.down()
      }
      const steps = Math.max(1, Math.round(Math.abs(to - from) / stepDeg))
      for (let i = 1; i <= steps; i++) await page.mouse.move(...point(from + ((to - from) * i) / steps, r))
      if (release) await page.mouse.up()
    }
    const before = await scrollState()
    await turn(-10, 17, { release: false })
    const midValue = await value()
    const midAngle = await angle()
    await turn(17, 44, { press: false })
    await page.waitForTimeout(300)
    check('시계 방향으로 54도 돌리면 20% 커짐', (await value()) === 60, `${await value()}%`)
    check('돌리는 동안 손을 따라 바로 돎', midValue === 50 && Math.abs(midAngle - expected(50)) <= 1, `${midValue}%, ${midAngle}도`)
    const bar2 = await bar.getAttribute('aria-valuenow')
    check('볼륨 막대도 같은 값', Number(bar2) === 60, bar2)
    await turn(0, 150, { stepDeg: 15, release: false })
    const stopped = await value()
    await turn(150, 123, { press: false })
    check('끝에 닿으면 더 돌려도 100%에서 멈춤', stopped === 100, `${stopped}%`)
    check('끝에서 반대로 돌리면 바로 줄어듦', (await value()) === 90, `${await value()}%`)
    await turn(0, -400, { stepDeg: 20 })
    check('반시계로 많이 돌려도 0%에서 멈춤', (await value()) === 0, `${await value()}%`)
    await turn(-40, 41, { r: 45 })
    check('노브 바깥에서 크게 돌려도 각도만큼 돎', (await value()) === 30, `${await value()}%`)
    await page.mouse.move(cx, cy - 30)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) await page.mouse.move(cx, cy - 30 + i * 5)
    await page.mouse.up()
    check('중심을 가로질러도 튀지 않음', (await value()) === 30, `${await value()}%`)
    await turn(90, 90)
    check('누르기만 하면 그대로', (await value()) === 30, `${await value()}%`)

    // 휠은 2%씩, 화면은 스크롤되지 않음
    await page.mouse.move(cx, cy)
    for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(40) }
    await page.waitForTimeout(300)
    check('휠을 올리면 2%씩 커짐', (await value()) === 40, `${await value()}%`)
    const after = await scrollState()
    check('노브를 돌리는 동안 화면이 스크롤되지 않음', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
    const blocked = await knob.evaluate((el) => [-100, 100].every((deltaY) => !el.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }))))
    check('노브 위의 휠은 화면 스크롤을 막음', blocked)

    // 키보드
    await knob.focus()
    await page.keyboard.press('ArrowUp')
    check('위 화살표는 1%', (await value()) === 41)
    await page.keyboard.press('PageDown')
    check('PageDown은 10%', (await value()) === 31)
    await page.keyboard.press('End')
    check('End는 100%', (await value()) === 100)
    await page.keyboard.press('Home')
    check('Home은 0%', (await value()) === 0)
    for (let i = 0; i < 5; i++) await page.keyboard.press('PageUp')
    const ring = await knob.evaluate((el) => Number(getComputedStyle(el.querySelector('circle.stroke-point')).opacity))
    check('키보드로 오면 테두리가 보임', ring === 1, ring)
    const inside = await page.evaluate(() => {
      const lp = document.querySelector('[aria-label="LP"]').getBoundingClientRect()
      const ring = document.querySelector('[data-volume-knob] circle.stroke-point').getBoundingClientRect()
      return ring.right <= lp.right && ring.bottom <= lp.bottom
    })
    check('테두리가 LP 가장자리에 잘리지 않음', inside)
    await knob.evaluate((el) => el.blur())
    await page.mouse.click(cx, cy)
    const clickRing = await knob.evaluate((el) => Number(getComputedStyle(el.querySelector('circle.stroke-point')).opacity))
    check('마우스로 누를 때는 테두리가 안 보임', clickRing === 0, clickRing)
    await knob.focus()

    // 음소거하면 0으로, 풀면 돌아감. 음소거 중 노브를 돌리면 풀림
    await page.getByRole('button', { name: '음소거', exact: true }).click()
    await page.waitForTimeout(400)
    check('음소거하면 노브가 0을 가리킴', (await value()) === 0 && (await angle()) === expected(0), `${await value()}%, ${await angle()}도`)
    await page.getByRole('button', { name: '음소거 해제' }).click()
    await page.waitForTimeout(400)
    check('음소거를 풀면 돌아옴', (await value()) === 50 && (await angle()) === expected(50), `${await value()}%`)
    await page.getByRole('button', { name: '음소거', exact: true }).click()
    await knob.focus()
    await page.keyboard.press('ArrowUp')
    const unmuted = await page.getByRole('button', { name: '음소거', exact: true }).count()
    check('음소거 중 노브를 돌리면 0에서부터 커지고 음소거가 풀림', (await value()) === 1 && unmuted === 1, `${await value()}%`)
    await page.keyboard.press('End')
    await page.waitForTimeout(300)
    const full = await page.evaluate(() => window.__audio.volume)
    check('끝까지 돌리면 실제 소리도 최대', Math.abs(full - 1) < 0.001, String(full))
    await page.keyboard.press('Home')
    for (let i = 0; i < 3; i++) await page.keyboard.press('PageUp')
    await page.waitForTimeout(300)
    const lowered = await page.evaluate(() => window.__audio.volume)
    check('30%로 돌리면 실제 소리도 줄어듦', Math.abs(lowered - 0.3) < 0.001, String(lowered))
  } else {
    const cdp = await ctx.newCDPSession(page)
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y, id: 1 })) })
    const before = await scrollState()
    const at = (deg) => [cx + 25 * Math.sin((deg * Math.PI) / 180), cy - 25 * Math.cos((deg * Math.PI) / 180)]
    await touch('touchStart', [at(0)])
    for (let i = 1; i <= 36; i++) { await touch('touchMove', [at(-3 * i)]); await page.waitForTimeout(16) }
    await touch('touchEnd', [])
    await page.waitForTimeout(300)
    const down = await value()
    check('손가락으로 반시계 108도 돌리면 40% 작아짐', down === 60, `${down}%`)
    const after = await scrollState()
    check('끄는 동안 화면이 밀리지 않음', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
    await knob.tap()
    await page.waitForTimeout(300)
    check('탭만 하면 볼륨이 그대로', (await value()) === 60, `${await value()}%`)
    const state = await page.evaluate(() => ({ hash: location.hash, scrollY, docH: document.documentElement.scrollHeight, inner: innerHeight }))
    check('탭해도 화면이 바뀌거나 밀리지 않음', state.hash.startsWith('#/now-playing') && state.scrollY === 0 && state.docH <= state.inner, JSON.stringify(state))
    check('휴대폰 노브의 누를 자리가 44px 이상', box.width >= 44, `${box.width.toFixed(0)}px`)
    const gain = await page.evaluate(() => window.__audio.volume)
    check('실제 소리도 60%', Math.abs(gain - 0.6) < 0.001, String(gain))
  }
  await page.locator('[aria-label="LP"]').screenshot({ path: path.join(shots, `${device}-${scheme}-lp-after.png`) })
  check('오류 없음', problems.length === 0, problems.slice(0, 3).join(' | '))
  console.log(`${pass} passed, ${fail} failed`)
  await browser.close()
  server.close()
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e.message.split('\n').slice(0, 3).join(' ')); process.exit(1) })
