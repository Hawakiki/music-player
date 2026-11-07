// 2단계 검증. 실제 폴더 선택 창은 자동화할 수 없어서 OPFS의 실제 디렉터리 핸들로 대체한다.
// usage: node verify2.cjs <distDir> <shotDir>
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { chromium } = require('playwright-core')

const [dist, shots] = process.argv.slice(2)
const BASE = '/music-player/'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  if (!url.startsWith(BASE)) { res.writeHead(404); return res.end() }
  const file = path.join(dist, url.slice(BASE.length) || 'index.html')
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` (${detail})` : ''}`) }

// 앱 코드보다 먼저 실행된다. 설정값은 localStorage로 넘겨서 새로고침해도 유지한다.
const stub = () => {
  try {
    window.showDirectoryPicker = async () => {
      const name = localStorage.getItem('t:pick')
      if (name === 'cancel') throw new DOMException('cancel', 'AbortError')
      let dir = await navigator.storage.getDirectory()
      for (const part of name.split('/')) dir = await dir.getDirectoryHandle(part)
      return dir
    }
    FileSystemHandle.prototype.queryPermission = async function () { return localStorage.getItem('t:query') || 'granted' }
    FileSystemHandle.prototype.requestPermission = async function () {
      localStorage.setItem('t:activation', String(navigator.userActivation.isActive))
      return localStorage.getItem('t:request') || 'granted'
    }
  } catch {}
}

;(async () => {
  fs.mkdirSync(shots, { recursive: true })
  await new Promise((r) => server.listen(4174, r))
  const url = `http://localhost:4174${BASE}`
  const browser = await chromium.launch({ channel: 'msedge' })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  await ctx.addInitScript(stub)
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`) })

  await page.goto(url, { waitUntil: 'networkidle' })

  const mk = (paths) => page.evaluate(async (list) => {
    const root = await navigator.storage.getDirectory()
    for (const p of list) {
      const parts = p.split('/'), file = parts.pop()
      let dir = root
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
      if (file) await dir.getFileHandle(file, { create: true })
    }
  }, paths)
  const rm = (name) => page.evaluate(async (n) => (await navigator.storage.getDirectory()).removeEntry(n, { recursive: true }), name)
  const opt = (k, v) => page.evaluate(([a, b]) => (b === null ? localStorage.removeItem(a) : localStorage.setItem(a, b)), [k, v])
  const side = () => page.getByRole('region', { name: '폴더' })
  const addButton = () => side().getByRole('button', { name: '폴더 추가' })
  const pick = async (name) => { await opt('t:pick', name); await addButton().click() }
  const row = (name) => side().getByRole('link', { name: new RegExp(name) })
  const notice = () => page.getByRole('status').innerText()
  const settle = async (name, text) => row(name).filter({ hasText: text }).waitFor({ timeout: 8000 }).then(() => true, () => false)
  const dbCount = () => page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('music-player')
    r.onerror = rej
    r.onsuccess = () => { const q = r.result.transaction('folders').objectStore('folders').count(); q.onsuccess = () => { r.result.close(); res(q.result) } }
  }))

  await mk(['음악/아티스트/앨범/01 첫 곡.flac', '음악/아티스트/앨범/2 둘째.mp3', '음악/아티스트/앨범/10 열째.m4a', '음악/아티스트/앨범/cover.jpg',
    '음악/메모.txt', '음악/옛날.wma', '음악/.숨김/비밀.mp3', '음악/대문자.MP3', '라이브 녹음/공연.opus', '부모/자식/곡.mp3'])

  // 취소
  await pick('cancel')
  await page.waitForTimeout(200)
  check('선택 창 취소는 아무 일도 없음', await dbCount() === 0 && (await notice()) === '')

  // 추가, 스캔
  await pick('음악')
  check('폴더 추가 후 4곡', await settle('음악', '4곡'))
  await row('음악').click()
  await page.getByRole('heading', { name: '음악', level: 1 }).waitFor()
  const names = await page.locator('main ol li button > span:nth-child(2) > span:first-child').allInnerTexts()
  check('오디오만 수집, 경로 기준 자연 정렬', JSON.stringify(names) === JSON.stringify(['대문자', '01 첫 곡', '2 둘째', '10 열째']), names.join(' | '))
  check('미지원 형식 개수 표시', (await page.locator('main').innerText()).includes('재생할 수 없는 형식 1개 제외'))
  check('하위 경로 표시', (await page.locator('main').innerText()).includes('아티스트/앨범'))
  const folderUrl = page.url()

  // 자동 재연결
  await page.reload({ waitUntil: 'networkidle' })
  check('새로고침: 자동으로 다시 연결', await settle('음악', '4곡'))
  check('새로고침: 폴더 상세 화면 유지', page.url() === folderUrl, page.url())
  check('새로고침: 상세 목록 복원', await page.locator('main ol li').count() === 4)

  // 여러 폴더
  await pick('라이브 녹음')
  check('두 번째 폴더 추가', await settle('라이브 녹음', '1곡'))
  await page.reload({ waitUntil: 'networkidle' })
  await settle('라이브 녹음', '1곡')
  const order = await side().getByRole('link').allInnerTexts()
  check('폴더 순서 유지', order[0].startsWith('음악') && order[1].startsWith('라이브 녹음'), order.join(' / '))

  // 중복
  await pick('음악')
  await page.waitForTimeout(200)
  check('같은 폴더는 거부', (await notice()).includes('이미 추가된 폴더입니다') && await dbCount() === 2, await notice())
  await pick('음악/아티스트')
  await page.waitForTimeout(200)
  check('안쪽 폴더는 거부', (await notice()).includes('이미 추가된 폴더 안에') && await dbCount() === 2, await notice())
  await pick('부모/자식')
  await settle('자식', '1곡')
  await pick('부모')
  await page.waitForTimeout(200)
  check('바깥 폴더는 거부', (await notice()).includes('이 폴더 안에 이미') && await dbCount() === 3, await notice())
  await page.goto(`${url}#/folders`)
  await page.locator('main li', { hasText: '자식' }).getByRole('button', { name: '제거' }).click()
  await page.waitForTimeout(150)
  check('제거하면 저장소에서도 삭제', await dbCount() === 2)
  check('제거해도 실제 파일은 유지', await page.evaluate(async () => { const r = await navigator.storage.getDirectory(); const d = await (await r.getDirectoryHandle('부모')).getDirectoryHandle('자식'); return !!(await d.getFileHandle('곡.mp3')) }))

  // 권한 필요
  await opt('t:query', 'prompt')
  await page.goto(`${url}#/albums`)
  await page.reload({ waitUntil: 'networkidle' })
  const reconnect = side().getByRole('button', { name: '다시 연결' })
  check('권한 없으면 다시 연결 표시', await reconnect.count() === 2, String(await reconnect.count()))
  check('앨범 화면 안내', (await page.locator('main').innerText()).includes('폴더 2개를 다시 연결하면'))
  await opt('t:request', 'denied')
  await reconnect.first().click()
  await page.waitForTimeout(200)
  check('거부하면 안내하고 유지', (await notice()).includes('허용되지 않았습니다') && await reconnect.count() === 2)
  await opt('t:request', 'granted')
  await reconnect.first().click()
  check('허용하면 다시 스캔', await settle('음악', '4곡'))
  check('requestPermission이 클릭 안에서 호출됨', await page.evaluate(() => localStorage.getItem('t:activation')) === 'true')
  await opt('t:query', null)

  // 폴더 없어짐
  await page.goto(`${url}#/folders`)
  await page.reload({ waitUntil: 'networkidle' })
  await settle('라이브 녹음', '1곡')
  await rm('라이브 녹음')
  await page.locator('main li', { hasText: '라이브 녹음' }).getByRole('button', { name: '다시 검색' }).click()
  await side().getByRole('button', { name: '다시 선택' }).waitFor({ timeout: 5000 })
  check('폴더가 없어지면 찾을 수 없음 표시', (await page.locator('main').innerText()).includes('폴더를 찾을 수 없습니다'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  check('새로고침해도 찾을 수 없음 유지', await side().getByRole('button', { name: '다시 선택' }).count() === 1)
  const missingId = await page.evaluate(() => document.querySelector('[aria-label="폴더"] a[href*="folders/"]:nth-of-type(1)') && [...document.querySelectorAll('[aria-label="폴더"] a')].find((a) => a.textContent.includes('라이브'))?.getAttribute('href'))
  await mk(['다른 위치/라이브 녹음 옮김/공연.opus', '다른 위치/라이브 녹음 옮김/앙코르.opus'])
  await opt('t:pick', '다른 위치/라이브 녹음 옮김')
  await side().getByRole('button', { name: '다시 선택' }).click()
  check('다시 선택하면 복구', await settle('라이브 녹음 옮김', '2곡'))
  const newId = await page.evaluate(() => [...document.querySelectorAll('[aria-label="폴더"] a')].find((a) => a.textContent.includes('라이브'))?.getAttribute('href'))
  check('다시 선택해도 폴더 id 유지', missingId === newId, `${missingId} → ${newId}`)

  // 끌어다 놓기: 낱개 파일
  const drop = (files, stage = 'drop') => page.evaluate(async ([list, last]) => {
    const dt = new DataTransfer()
    for (const name of list) dt.items.add(new File(['x'], name))
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }))
    if (last === 'enter') return
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, [files, stage])
  await drop(['낱개.mp3'], 'enter')
  check('끌어오면 안내 표시', await page.getByText('여기에 놓으면 추가됩니다').isVisible())
  await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.mp3')); window.dispatchEvent(new DragEvent('dragleave', { dataTransfer: dt, bubbles: true })) })
  await page.waitForTimeout(100)
  check('창을 벗어나면 안내 사라짐', await page.getByText('여기에 놓으면 추가됩니다').count() === 0)
  await drop(['낱개.mp3', 'ignore.txt'])
  check('낱개 파일 추가', await settle('가져온 파일', '1곡'))
  await drop(['낱개.mp3', '또.flac'])
  check('같은 파일은 중복 없이 합침', await settle('가져온 파일', '2곡'))
  await drop(['메모.txt'])
  await page.waitForTimeout(200)
  check('오디오가 없으면 안내', (await notice()).includes('오디오 파일을 찾지 못했습니다'), await notice())
  check('낱개 파일은 저장소에 안 남음', await dbCount() === 2)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(200)
  check('새로고침하면 낱개 파일 사라짐', await row('가져온 파일').count() === 0)

  // 끌어다 놓기: 폴더 핸들
  await mk(['끌어온 폴더/곡.mp3'])
  await page.evaluate(async () => {
    const handle = await (await navigator.storage.getDirectory()).getDirectoryHandle('끌어온 폴더')
    DataTransferItem.prototype.getAsFileSystemHandle = async () => handle
    const dt = new DataTransfer()
    dt.items.add(new File(['x'], 'placeholder'))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  })
  check('폴더 드롭은 저장되는 폴더로 추가', await settle('끌어온 폴더', '1곡') && await dbCount() === 3)

  // 경합
  await page.goto(`${url}#/folders`)
  await page.waitForTimeout(200)
  const again = page.locator('main li', { hasText: '음악' }).getByRole('button', { name: '다시 검색' })
  await page.evaluate(() => { const b = [...document.querySelectorAll('main li')].find((l) => l.textContent.includes('음악')).querySelector('button'); b.click(); b.click() })
  check('다시 검색 연타해도 정상', await settle('음악', '4곡') && await again.count() === 1)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: path.join(shots, 'folders-black.jpg'), type: 'jpeg', quality: 88 })

  // 규모
  const generated = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const base = await root.getDirectoryHandle('대량', { create: true })
    const started = performance.now()
    for (let a = 0; a < 50; a++) {
      const album = await base.getDirectoryHandle(`앨범 ${a}`, { create: true })
      await Promise.all(Array.from({ length: 100 }, (_, t) => album.getFileHandle(`${t} 곡.flac`, { create: true })))
    }
    return Math.round(performance.now() - started)
  })
  await opt('t:pick', '대량')
  const t0 = Date.now()
  await addButton().click()
  const big = await settle('대량', '5,000곡')
  const scanMs = Date.now() - t0
  check('5,000곡 스캔', big && scanMs < 8000, `${scanMs}ms, 파일 생성 ${generated}ms`)
  const t1 = Date.now()
  await row('대량').click()
  await page.getByRole('heading', { name: '대량', level: 1 }).waitFor()
  await page.locator('main ol li').first().waitFor()
  await page.evaluate(() => { const m = document.querySelector('main'); m.scrollTop = m.scrollHeight })
  await page.waitForTimeout(300)
  const lastRow = await page.locator('main ol li').last().innerText()
  check('5,000곡 목록 표시', await page.locator('main ol li').count() < 80 && lastRow.includes('99 곡'), `${Date.now() - t1}ms, ${lastRow.replace(/\s+/g, ' ')}`)

  // 모바일
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${url}#/folders`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  check('모바일 폴더 화면 가로 넘침 없음', !overflow)
  await page.screenshot({ path: path.join(shots, 'folders-mobile.jpg'), type: 'jpeg', quality: 88 })

  check('콘솔/페이지 오류 없음', problems.length === 0, problems.slice(0, 4).join(' | '))
  await ctx.close()

  // 미지원 브라우저 경로
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })
  await ctx2.addInitScript(() => { delete window.showDirectoryPicker; delete Window.prototype.showDirectoryPicker })
  const p2 = await ctx2.newPage()
  const errs = []
  p2.on('pageerror', (e) => errs.push(e.message))
  await p2.goto(`${url}#/folders`, { waitUntil: 'networkidle' })
  check('대체 경로: 폴더 기억 불가 안내', (await p2.locator('main').innerText()).includes('폴더를 기억하지 못해서'))
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-'))
  const root = path.join(tmp, '내 음악')
  fs.mkdirSync(path.join(root, '앨범'), { recursive: true })
  for (const f of ['앨범/곡 1.mp3', '앨범/곡 2.flac', '앨범/표지.jpg', '다른.wma']) fs.writeFileSync(path.join(root, f), 'x')
  const chooser = p2.waitForEvent('filechooser')
  await p2.getByRole('region', { name: '폴더' }).getByRole('button', { name: '폴더 추가' }).click()
  await (await chooser).setFiles(root)
  const fallbackRow = p2.getByRole('region', { name: '폴더' }).getByRole('link', { name: /내 음악/ }).filter({ hasText: '2곡' })
  check('대체 경로: webkitdirectory로 폴더 추가', await fallbackRow.waitFor({ timeout: 5000 }).then(() => true, () => false))
  const text = await p2.locator('main').innerText()
  check('대체 경로: 세션 안내', text.includes('페이지를 닫으면 목록에서 사라집니다') && text.includes('재생할 수 없는 형식 1개 제외'), text.replace(/\s+/g, ' ').slice(0, 120))
  await fallbackRow.click()
  await p2.getByRole('heading', { name: '내 음악', level: 1 }).waitFor()
  check('대체 경로: 상대 경로 유지', (await p2.locator('main').innerText()).includes('앨범'))

  // 실제 드래그로 폴더 넣기 (getAsFileSystemHandle이 없는 브라우저 흉내)
  await p2.evaluate(() => { delete DataTransferItem.prototype.getAsFileSystemHandle })
  const cdp = await ctx2.newCDPSession(p2)
  const data = { items: [], files: [root], dragOperationsMask: 1 }
  let cdpOk = true
  try {
    await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x: 700, y: 400, data })
    await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x: 700, y: 400, data })
    await cdp.send('Input.dispatchDragEvent', { type: 'drop', x: 700, y: 400, data })
  } catch (e) { cdpOk = false; console.log('CDP 드래그 불가:', e.message) }
  if (cdpOk) {
    const rows = p2.getByRole('region', { name: '폴더' }).getByRole('link', { name: /내 음악/ })
    const got = await p2.waitForFunction(() => [...document.querySelectorAll('[aria-label="폴더"] a')].filter((a) => a.textContent.includes('내 음악')).length === 2, null, { timeout: 4000 }).then(() => true, () => false)
    check('실제 폴더 드래그: webkitGetAsEntry 경로', got && await rows.filter({ hasText: '2곡' }).count() === 2, String(await rows.count()))
  }
  check('대체 경로: 오류 없음', errs.length === 0, errs.join(' | '))
  await ctx2.close()

  // 스텁 없이 진짜 디스크 폴더를 진짜 드래그로 넣는다
  const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  const p3 = await ctx3.newPage()
  const errs3 = []
  p3.on('pageerror', (e) => errs3.push(e.message))
  await p3.goto(`${url}#/folders`, { waitUntil: 'networkidle' })
  const cdp3 = await ctx3.newCDPSession(p3)
  const data3 = { items: [], files: [root], dragOperationsMask: 1 }
  await cdp3.send('Input.dispatchDragEvent', { type: 'dragEnter', x: 700, y: 400, data: data3 })
  await cdp3.send('Input.dispatchDragEvent', { type: 'dragOver', x: 700, y: 400, data: data3 })
  await cdp3.send('Input.dispatchDragEvent', { type: 'drop', x: 700, y: 400, data: data3 })
  const region3 = p3.getByRole('region', { name: '폴더' })
  const realRow = region3.getByRole('link', { name: /내 음악/ })
  check('핸들이 안 돌아와도 드롭이 대체 경로로 추가됨', await realRow.filter({ hasText: '2곡' }).waitFor({ timeout: 5000 }).then(() => true, () => false))
  // 자동화 드래그 뒤에는 마우스 입력이 페이지에 오지 않아서 DOM으로 누른다.
  await p3.evaluate(() => [...document.querySelectorAll('main li button')].find((b) => b.textContent === '제거').click())
  check('세션 폴더 제거', await realRow.waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false))

  // 진짜 폴더 선택 창을 가로챌 수 있으면 실제 디스크 핸들까지 확인한다
  const p4 = await ctx3.newPage()
  p4.on('pageerror', (e) => errs3.push(e.message))
  await p4.goto(`${url}#/folders`, { waitUntil: 'networkidle' })
  const region4 = p4.getByRole('region', { name: '폴더' })
  const chooserWait = p4.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null)
  await region4.getByRole('button', { name: '폴더 추가' }).click()
  const realChooser = await chooserWait
  if (!realChooser) {
    console.log('INFO 진짜 폴더 선택 창은 자동화로 가로챌 수 없음')
  } else {
    await realChooser.setFiles(root)
    const realLink = region4.getByRole('link', { name: /내 음악/ })
    check('실제 폴더 선택: 2곡 스캔', await realLink.filter({ hasText: '2곡' }).waitFor({ timeout: 5000 }).then(() => true, () => false))
    const stored = await p4.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('music-player')
      r.onsuccess = () => {
        const q = r.result.transaction('folders').objectStore('folders').getAll()
        q.onsuccess = async () => {
          const v = q.result[0]
          res({ count: q.result.length, isHandle: v?.handle instanceof FileSystemDirectoryHandle, permission: await v?.handle.queryPermission({ mode: 'read' }) })
        }
      }
    }))
    check('실제 폴더 선택: 핸들 저장', stored.count === 1 && stored.isHandle, JSON.stringify(stored))
    await p4.reload({ waitUntil: 'networkidle' })
    await p4.waitForTimeout(500)
    console.log(`INFO 실제 핸들 새로고침 후: ${(await region4.innerText()).replace(/\s+/g, ' ')}`)
  }
  check('실제 드래그 경로: 오류 없음', errs3.length === 0, errs3.join(' | '))
  await ctx3.close()
  fs.rmSync(tmp, { recursive: true, force: true })

  await browser.close()
  server.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
