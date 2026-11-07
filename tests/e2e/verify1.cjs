// 1단계 검증: dist를 /music-player/ 하위 경로로 서빙하고 실제 브라우저에서 확인한다.
// usage: node verify1.cjs <distDir> <shotDir>
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')

const [dist, shots] = process.argv.slice(2)
const BASE = '/music-player/'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff' }

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  if (!url.startsWith(BASE)) { res.writeHead(404); return res.end('outside base') }
  const rel = url.slice(BASE.length) || 'index.html'
  const file = path.join(dist, rel)
  if (!file.startsWith(path.resolve(dist)) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found') }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` (${detail})` : ''}`)
}

;(async () => {
  fs.mkdirSync(shots, { recursive: true })
  await new Promise((r) => server.listen(4173, r))
  const url = `http://localhost:4173${BASE}`
  const browser = await chromium.launch({ channel: 'msedge' })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) problems.push(`console: ${m.text()}`) })
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`) })

  const isDark = () => page.evaluate(() => document.documentElement.classList.contains('dark'))
  const stored = () => page.evaluate(() => localStorage.getItem('music-player:theme'))
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  const openSettings = async () => { await page.getByRole('link', { name: '설정' }).first().click(); await page.getByRole('heading', { name: '설정', level: 1 }).waitFor() }
  const pick = (name) => page.locator('label', { hasText: new RegExp(`^${name}$`) }).click()

  // 첫 진입
  await page.goto(url, { waitUntil: 'networkidle' })
  check('첫 진입이 앨범으로 이동', page.url().endsWith('#/albums'), page.url())
  check('제목 앨범', await page.getByRole('heading', { level: 1 }).innerText() === '앨범')
  check('자동: 시스템 다크면 블랙', await isDark())
  const fontOk = await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('14px "Pretendard Variable"', '앨범') && [...document.fonts].some((f) => f.family.includes('Pretendard') && f.status === 'loaded') })
  check('Pretendard 로드', fontOk)
  check('배경색 토큰 블랙', await bg() === 'rgb(20, 21, 23)', await bg())

  // 자동 실시간 전환
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForTimeout(100)
  check('자동: 켜 둔 채 라이트로 바뀌면 따라감', !(await isDark()))
  check('배경색 토큰 화이트', await bg() === 'rgb(244, 245, 246)', await bg())
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(100)
  check('자동: 다시 다크로 따라감', await isDark())

  // 설정에서 고정
  await openSettings()
  check('설정 기본값 자동', await page.getByRole('radio', { name: '자동' }).isChecked())
  await pick('화이트')
  check('화이트 선택 적용', !(await isDark()))
  check('화이트 저장', await stored() === 'white', await stored())
  await page.emulateMedia({ colorScheme: 'light' }); await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(100)
  check('화이트: 시스템이 바뀌어도 유지', !(await isDark()))
  await page.reload({ waitUntil: 'networkidle' })
  check('화이트: 새로고침 후 유지', !(await isDark()) && await page.getByRole('radio', { name: '화이트' }).isChecked())

  await pick('블랙')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForTimeout(100)
  check('블랙: 시스템이 라이트여도 유지', await isDark())
  check('블랙 저장', await stored() === 'black', await stored())

  // React 없이도 인라인 스크립트가 먼저 적용되는지: JS 번들을 막고 새로고침
  await page.route('**/assets/index-*.js', (r) => r.abort())
  await page.reload()
  check('깜빡임 방지: 번들 없이도 블랙 적용', await isDark())
  await page.evaluate(() => localStorage.setItem('music-player:theme', 'white'))
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.reload()
  check('깜빡임 방지: 번들 없이도 화이트 적용', !(await isDark()))
  await page.unroute('**/assets/index-*.js')

  // 잘못된 저장값
  await page.evaluate(() => localStorage.setItem('music-player:theme', 'banana'))
  await page.reload({ waitUntil: 'networkidle' })
  check('잘못된 값은 자동 처리 (시스템 다크)', await isDark())
  check('잘못된 값이면 설정은 자동', await page.getByRole('radio', { name: '자동' }).isChecked())

  // 키보드
  await page.getByRole('radio', { name: '자동' }).focus()
  await page.keyboard.press('ArrowRight')
  check('키보드 방향키로 테마 변경', await stored() === 'black', await stored())
  await pick('자동')

  // 라우팅
  for (const name of ['폴더', '앨범', '아티스트', '장르', '재생목록', '즐겨찾기', '최근 추가']) {
    await page.getByRole('navigation', { name: '라이브러리' }).getByRole('link', { name }).click()
    check(`이동 ${name}`, await page.getByRole('heading', { level: 1 }).innerText() === name)
  }
  await page.goto(`${url}#/genres`); await page.reload({ waitUntil: 'networkidle' })
  check('하위 화면 새로고침 유지', await page.getByRole('heading', { level: 1 }).innerText() === '장르')
  await page.goto(`${url}#/nope`, { waitUntil: 'networkidle' })
  const redirected = await page.waitForURL('**/#/albums', { timeout: 3000 }).then(() => true, () => false)
  check('없는 경로는 앨범으로 (앱 안에서 이동)', redirected, page.url())
  const fresh = await ctx.newPage()
  await fresh.goto(`${url}#/nope`, { waitUntil: 'networkidle' })
  const freshRedirected = await fresh.waitForURL('**/#/albums', { timeout: 3000 }).then(() => true, () => false)
  check('없는 경로는 앨범으로 (새 탭에서 처음 열기)', freshRedirected, fresh.url())
  await fresh.close()

  // 스크린샷
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto(`${url}#/albums`, { waitUntil: 'networkidle' })
  await page.screenshot({ path: path.join(shots, 'desktop-black.jpg'), type: 'jpeg', quality: 88 })
  await page.goto(`${url}#/settings`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  // 클릭과 같은 틱에 색을 읽어서, 전환 효과 없이 한 번에 바뀌는지 본다.
  const instant = await page.evaluate(() => {
    const link = document.querySelector('nav[aria-label="라이브러리"] a[href="#/folders"]')
    document.querySelector('input[value="white"]').click()
    return getComputedStyle(link).color
  })
  check('테마 전환 시 색이 한 번에 바뀜', instant === 'rgb(95, 101, 108)', instant)
  await page.waitForTimeout(400)
  const active = await page.evaluate(() => [...document.querySelectorAll('aside a')].filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent))
  check('설정 화면에서는 설정만 활성', active.length === 1 && active[0] === '설정', active.join(','))
  check('화이트 라디오 선택됨', await page.getByRole('radio', { name: '화이트' }).isChecked())
  await page.screenshot({ path: path.join(shots, 'settings-white.jpg'), type: 'jpeg', quality: 88 })
  await pick('자동')

  // 화면 크기
  const shape = () => page.evaluate(() => ({
    sidebar: !!document.querySelector('aside:not([aria-label])')?.offsetWidth,
    queue: !!document.querySelector('aside[aria-label="대기열"]')?.offsetWidth,
    mobile: !!document.querySelector('nav[aria-label="메뉴"]')?.offsetWidth,
    overflowX: document.documentElement.scrollWidth > innerWidth,
  }))
  for (const [w, h, want] of [[1440, 900, { sidebar: true, queue: true, mobile: false }], [1024, 768, { sidebar: true, queue: false, mobile: false }], [390, 844, { sidebar: false, queue: false, mobile: true }]]) {
    await page.setViewportSize({ width: w, height: h })
    await page.waitForTimeout(100)
    const s = await shape()
    check(`${w}px 레이아웃`, s.sidebar === want.sidebar && s.queue === want.queue && s.mobile === want.mobile && !s.overflowX, JSON.stringify(s))
  }
  await page.goto(`${url}#/albums`, { waitUntil: 'networkidle' })
  await page.screenshot({ path: path.join(shots, 'mobile-black.jpg'), type: 'jpeg', quality: 88 })
  await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '설정' }).click()
  check('모바일 메뉴로 설정 이동', await page.getByRole('heading', { level: 1 }).innerText() === '설정')

  check('콘솔/요청 오류 없음', problems.length === 0, problems.slice(0, 5).join(' | '))
  await browser.close()
  server.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
