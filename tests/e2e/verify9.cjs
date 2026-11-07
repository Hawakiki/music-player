// 휴대폰 검증: S22와 같은 크기와 터치 환경에서 모든 화면을 돌며 조작을 실제로 탭한다.
// usage: node verify9.cjs <distDir> <shotDir>
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')

const [dist, shots, live] = process.argv.slice(2)
const FX = path.join(__dirname, '..', 'out', 'fixtures', 'restore-app')
const BASE = '/music-player/'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const S22 = {
  viewport: { width: 360, height: 780 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S901N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
}

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` (${detail})` : ''}`) }

const stub = () => {
  try {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('fx')
    FileSystemHandle.prototype.queryPermission = async function () { return 'granted' }
    const NativeAudio = window.Audio
    window.Audio = function (...a) { const el = new NativeAudio(...a); window.__audio = el; return el }
  } catch {}
}

;(async () => {
  const files = fs.readdirSync(FX)
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
  await new Promise((r) => server.listen(4190, r))
  const browser = await chromium.launch({ channel: 'msedge' })
  const ctx = await browser.newContext({ ...S22, colorScheme: 'light' })
  await ctx.addInitScript(stub)
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) problems.push(`console: ${m.text()}`) })

  if (live) {
    await page.route('**/__fx/*', (route) => route.fulfill({ path: path.join(FX, path.basename(new URL(route.request().url()).pathname)), contentType: 'application/octet-stream' }))
  }
  await page.goto(live ?? `http://localhost:4190${BASE}`, { waitUntil: 'networkidle' })
  await page.evaluate(async (list) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('fx', { create: true })
    for (const name of list) {
      const bytes = await (await fetch(`__fx/${name}`)).arrayBuffer()
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
      await w.write(bytes); await w.close()
    }
  }, files)
  await page.evaluate(() => { location.hash = '#/folders' })
  await page.getByRole('button', { name: '폴더 추가' }).first().tap()
  await page.locator('main li', { hasText: 'fx' }).getByRole('link').tap({ timeout: 20000 })
  await page.locator('main ol li').first().waitFor({ timeout: 20000 })
  await page.locator('main ol li', { hasText: '압축 128' }).first().locator('button').first().tap()
  await page.waitForFunction(() => !window.__audio.paused && window.__audio.currentTime > 0.1, null, { timeout: 10000 })

  const go = async (hash) => {
    await page.evaluate((h) => { window.scrollTo(0, 0); location.hash = h }, hash)
    await page.waitForTimeout(350)
  }
  const page_ = () => page.evaluate(() => {
    const inView = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth }
    return {
      doc: document.documentElement.scrollHeight,
      wide: document.documentElement.scrollWidth,
      view: innerHeight,
      width: innerWidth,
      y: Math.round(scrollY),
      visible: [...document.querySelectorAll('a, button, label, h1, [role=slider]')].filter(inView).length,
    }
  })
  const fits = (s) => s.doc <= s.view + 1 && s.wide <= s.width + 1 && s.y === 0 && s.visible >= 2

  // 어느 화면에서도 앱 바깥으로 문서가 늘어나면 안 된다
  const ROUTES = ['#/albums', '#/artists', '#/tracks', '#/folders', '#/favorites', '#/playlists', '#/search', '#/settings', '#/now-playing?tab=queue', '#/now-playing?tab=eq', '#/now-playing?tab=sound', '#/now-playing?tab=info']
  for (const route of ROUTES) {
    await go(route)
    const s = await page_()
    check(`${route}: 문서가 화면 안에 있음`, fits(s), JSON.stringify(s))
  }

  // 라디오 하나하나를 탭한다
  const optional = ['vu-reference', 'lp-speed']
  const tapRadios = async (title, only) => {
    const names = only ?? await page.evaluate(() => [...new Set([...document.querySelectorAll('input[type=radio]')].map((e) => e.name))])
    for (const name of names) {
      const values = await page.evaluate((n) => [...document.querySelectorAll(`input[name="${n}"]`)].map((e) => e.value), name)
      const failures = []
      let tapped = 0
      for (const value of [...values.slice(1), values[0]]) {
        const input = page.locator(`input[name="${name}"][value="${value}"]`)
        if (await input.isDisabled()) continue
        const label = page.locator(`label:has(input[name="${name}"][value="${value}"])`)
        await label.scrollIntoViewIfNeeded()
        await page.waitForTimeout(80)
        const before = await label.boundingBox()
        await label.tap()
        await page.waitForTimeout(160)
        const after = await label.boundingBox()
        const s = await page_()
        tapped += 1
        const moved = Math.abs((after?.y ?? 9999) - before.y)
        if (!(await input.isChecked()) || !fits(s) || moved > 60) failures.push(`${value}: 움직임 ${Math.round(moved)}px ${JSON.stringify(s)}`)
        await page.evaluate(() => window.scrollTo(0, 0))
      }
      if (tapped > 0 || only || !optional.includes(name)) check(`${title} ${name}: ${tapped}개 탭`, failures.length === 0 && tapped > 0, failures[0] ?? '')
    }
  }
  const tapSwitches = async (title) => {
    const count = await page.getByRole('switch').count()
    const failures = []
    for (let i = 0; i < count; i++) {
      const item = page.getByRole('switch').nth(i)
      for (let pressed = 0; pressed < 2; pressed++) {
        await item.scrollIntoViewIfNeeded()
        await item.tap()
        await page.waitForTimeout(160)
        const s = await page_()
        if (!fits(s)) failures.push(JSON.stringify(s))
        await page.evaluate(() => window.scrollTo(0, 0))
      }
    }
    check(`${title} 스위치 ${count}개 탭`, failures.length === 0, failures[0] ?? '')
  }
  const tapSliders = async (title) => {
    const count = await page.getByRole('slider').count()
    const failures = []
    for (let i = 0; i < count; i++) {
      const item = page.getByRole('slider').nth(i)
      await item.scrollIntoViewIfNeeded()
      const box = await item.boundingBox()
      if (!box) continue
      await page.touchscreen.tap(box.x + box.width / 2 + 24, box.y + box.height / 2)
      await page.waitForTimeout(120)
      const s = await page_()
      if (!fits(s)) failures.push(JSON.stringify(s))
      await page.evaluate(() => window.scrollTo(0, 0))
    }
    check(`${title} 슬라이더 ${count}개 탭`, failures.length === 0 && count > 0, failures[0] ?? '')
  }

  // 음향 탭
  await go('#/now-playing?tab=sound')
  await page.getByRole('slider', { name: '진공관', exact: true }).focus()
  await page.keyboard.press('End')
  await page.waitForTimeout(200)
  await tapRadios('음향')
  await tapSwitches('음향')
  await tapSliders('음향')
  const reset = page.getByRole('button', { name: '초기화' })
  await reset.scrollIntoViewIfNeeded()
  await reset.tap()
  await page.waitForTimeout(200)
  check('음향 초기화 후 정상', fits(await page_()), JSON.stringify(await page_()))

  // 고른 값이 소리까지 이어지는지
  const restoreLabel = page.locator('label:has(input[name="restore"][value="medium"])')
  await restoreLabel.scrollIntoViewIfNeeded()
  await restoreLabel.tap()
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(shots, 'mobile-sound.jpg'), type: 'jpeg', quality: 85 })
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('music-player:sound')))
  check('탭한 값이 저장됨', saved.restore === 'medium', saved.restore)

  // 이퀄라이저 탭
  await go('#/now-playing?tab=eq')
  await tapSwitches('이퀄라이저')
  await tapSliders('이퀄라이저')

  // 설정
  await go('#/settings')
  await tapRadios('설정')
  await tapSwitches('설정')
  const vuOption = page.locator('label:has(input[name="cover-view"][value="vu"])')
  await vuOption.scrollIntoViewIfNeeded()
  await vuOption.tap()
  await page.waitForTimeout(200)
  await tapRadios('VU 켠 설정', ['vu-reference'])
  await vuOption.scrollIntoViewIfNeeded()
  await vuOption.tap()
  await page.waitForTimeout(150)
  await page.screenshot({ path: path.join(shots, 'mobile-settings.jpg'), type: 'jpeg', quality: 85 })
  await go('#/now-playing?tab=sound')
  await page.locator('[aria-label="VU 미터"]').waitFor({ timeout: 5000 })
  await page.waitForTimeout(700)
  const vuPage = await page_()
  check('VU를 켠 재생 화면이 화면 안에 있음', fits(vuPage), JSON.stringify(vuPage))
  const vuBox = await page.locator('[aria-label="VU 미터"]').boundingBox()
  check('VU가 표지 자리를 정사각형으로 채움', Math.abs(vuBox.width - vuBox.height) < 2 && vuBox.width > 300, JSON.stringify(vuBox))
  await page.screenshot({ path: path.join(shots, 'mobile-vu.jpg'), type: 'jpeg', quality: 85 })

  await go('#/settings')
  const lpOption = page.locator('label:has(input[name="cover-view"][value="lp"])')
  await lpOption.scrollIntoViewIfNeeded()
  await lpOption.tap()
  await page.waitForTimeout(200)
  await tapRadios('LP 켠 설정', ['lp-speed'])
  await lpOption.scrollIntoViewIfNeeded()
  await lpOption.tap()
  await page.waitForTimeout(150)
  await page.screenshot({ path: path.join(shots, 'mobile-settings.jpg'), type: 'jpeg', quality: 85 })
  await go('#/now-playing?tab=sound')
  await page.locator('[aria-label="LP"]').waitFor({ timeout: 5000 })
  await page.waitForTimeout(500)
  const lpPage = await page_()
  check('LP를 켠 재생 화면이 화면 안에 있음', fits(lpPage), JSON.stringify(lpPage))
  const lpBox = await page.locator('[aria-label="LP"]').boundingBox()
  check('LP가 표지 자리를 정사각형으로 채움', Math.abs(lpBox.width - lpBox.height) < 2 && lpBox.width > 300, JSON.stringify(lpBox))
  await page.screenshot({ path: path.join(shots, 'mobile-lp.jpg'), type: 'jpeg', quality: 85 })

  await go('#/settings')
  const cassetteOption = page.locator('label:has(input[name="cover-view"][value="cassette"])')
  await cassetteOption.scrollIntoViewIfNeeded()
  await cassetteOption.tap()
  await page.waitForTimeout(150)
  await go('#/now-playing?tab=sound')
  await page.locator('[aria-label="카세트"]').waitFor({ timeout: 5000 })
  await page.waitForTimeout(500)
  const tapePage = await page_()
  check('카세트를 켠 재생 화면이 화면 안에 있음', fits(tapePage), JSON.stringify(tapePage))
  const tapeBox = await page.locator('[data-cassette]').boundingBox()
  check('휴대폰에서 카세트가 세로로 긺', tapeBox.height > tapeBox.width * 1.5 && tapeBox.x >= 0 && tapeBox.x + tapeBox.width <= 360, JSON.stringify(tapeBox))
  await page.screenshot({ path: path.join(shots, 'mobile-cassette.jpg'), type: 'jpeg', quality: 85 })

  await go('#/settings')
  const scopeOption = page.locator('label:has(input[name="cover-view"][value="scope"])')
  await scopeOption.scrollIntoViewIfNeeded()
  await scopeOption.tap()
  await page.waitForTimeout(150)
  const settingsFit = await page_()
  check('표지 자리 버튼 5개가 휴대폰 폭에 맞음', fits(settingsFit), JSON.stringify(settingsFit))
  await go('#/now-playing?tab=sound')
  await page.locator('[data-scope]').waitFor({ timeout: 5000 })
  await page.waitForTimeout(1500)
  const scopePage = await page_()
  check('측정을 켠 재생 화면이 화면 안에 있음', fits(scopePage), JSON.stringify(scopePage))
  const scopeBox = await page.locator('[data-scope]').boundingBox()
  check('측정이 표지 자리를 정사각형으로 채움', Math.abs(scopeBox.width - scopeBox.height) < 2 && scopeBox.width > 300, JSON.stringify(scopeBox))
  await page.screenshot({ path: path.join(shots, 'mobile-scope.jpg'), type: 'jpeg', quality: 85 })
  const slot = page.locator('[data-slot-index="2"] button')
  await slot.tap()
  const item = page.getByRole('menuitem', { name: '스펙트럼', exact: true })
  await item.waitFor({ timeout: 3000 })
  const menuFits = await item.boundingBox()
  check('측정 메뉴가 화면 안에 있음', menuFits.x >= 0 && menuFits.x + menuFits.width <= 360 && menuFits.y >= 0 && menuFits.y + menuFits.height <= 780, JSON.stringify(menuFits))
  await item.tap()
  await page.waitForTimeout(900)
  check('탭으로 모듈을 바꿈', (await page.locator('[data-slot-index="2"] canvas').getAttribute('data-module')) === 'spectrum')
  const afterMenu = await page_()
  check('메뉴를 써도 화면이 밀리지 않음', fits(afterMenu), JSON.stringify(afterMenu))
  await page.screenshot({ path: path.join(shots, 'mobile-scope-custom.jpg'), type: 'jpeg', quality: 85 })
  const pick = async (index, label) => {
    await page.locator(`[data-slot-index="${index}"] button`).tap()
    const entry = page.getByRole('menuitem', { name: label, exact: true })
    await entry.waitFor({ timeout: 3000 })
    await entry.tap()
    await page.waitForTimeout(700)
  }
  await pick(1, '위상과 좌우')
  await pick(2, 'VU')
  await page.screenshot({ path: path.join(shots, 'mobile-scope-a.jpg'), type: 'jpeg', quality: 85 })
  await pick(1, '오실로스코프')
  await pick(2, '레벨')
  await pick(0, '스펙트럼')
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(shots, 'mobile-scope-b.jpg'), type: 'jpeg', quality: 85 })
  const shapes = await page.evaluate(() => [...document.querySelectorAll('[data-module]')].map((canvas) => ({
    module: canvas.dataset.module,
    stretch: (canvas.width / canvas.height) / (canvas.clientWidth / canvas.clientHeight),
    width: canvas.width,
    height: canvas.height,
  })))
  check('측정 캔버스가 찌그러지지 않음', shapes.every(({ stretch }) => Math.abs(stretch - 1) < 0.02), JSON.stringify(shapes))
  check('측정 캔버스가 또렷함', shapes.every(({ width }) => width >= 200), JSON.stringify(shapes.map(({ width, height }) => `${width}x${height}`)))
  const afterPicks = await page_()
  check('모듈을 여러 번 바꿔도 화면이 밀리지 않음', fits(afterPicks), JSON.stringify(afterPicks))

  // 손가락으로 끌어도 빈 화면으로 가지 않아야 한다
  await go('#/now-playing?tab=sound')
  await page.evaluate(() => window.scrollTo(0, 99999))
  await page.waitForTimeout(150)
  check('문서를 끝까지 내려도 앱이 밀리지 않음', (await page.evaluate(() => scrollY)) === 0)

  check('음악이 계속 재생됨', await page.evaluate(() => !window.__audio.paused || window.__audio.ended))
  const real = problems.filter((p) => !p.includes('no supported source'))
  check('오류 없음', real.length === 0, real.slice(0, 4).join(' | '))
  await browser.close()
  server.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
