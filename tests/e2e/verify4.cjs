// 4단계 검증: ffmpeg로 만든 진짜 오디오 파일로 태그, 앨범 아트, 라이브러리 화면을 본다.
// usage: node verify4.cjs <distDir> <shotDir>
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')

const [dist, shots] = process.argv.slice(2)
const FX = path.join(__dirname, '..', 'out', 'fixtures')
const BASE = '/music-player/'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' }
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  if (!url.startsWith(BASE)) { res.writeHead(404); return res.end() }
  const rel = url.slice(BASE.length) || 'index.html'
  if (rel === '__blank') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>blank</title>') }
  const file = rel.startsWith('__fx/') ? path.join(FX, rel.slice(5)) : path.join(dist, rel)
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` (${detail})` : ''}`) }

const stub = () => {
  try {
    window.showDirectoryPicker = async () => {
      let dir = await navigator.storage.getDirectory()
      for (const part of localStorage.getItem('t:pick').split('/')) dir = await dir.getDirectoryHandle(part)
      return dir
    }
    FileSystemHandle.prototype.queryPermission = async function () { return 'granted' }
    const NativeAudio = window.Audio
    window.Audio = function (...args) { const el = new NativeAudio(...args); window.__audio = el; return el }
    window.__reads = { read: 0, unchanged: 0, unavailable: 0 }
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); this.addEventListener('message', (e) => { window.__reads[e.data.kind] += 1 }) }
    }
  } catch {}
}

;(async () => {
  fs.mkdirSync(shots, { recursive: true })
  const manifest = JSON.parse(fs.readFileSync(path.join(FX, 'manifest.json'), 'utf8'))
  const audioFiles = manifest.filter((f) => !f.endsWith('.jpg'))
  const N = audioFiles.length
  await new Promise((r) => server.listen(4177, r))
  const url = `http://localhost:4177${BASE}`
  const browser = await chromium.launch({ channel: 'msedge' })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  await ctx.addInitScript(stub)
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) problems.push(`console: ${m.text()}`) })
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) problems.push(`${r.status()} ${r.url()}`) })

  const dbCounts = () => page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('music-player')
    r.onerror = rej
    r.onsuccess = () => {
      const db = r.result, names = [...db.objectStoreNames], out = { version: db.version }
      const tx = db.transaction(names)
      let left = names.length
      for (const n of names) { const q = tx.objectStore(n).count(); q.onsuccess = () => { out[n] = q.result; if (--left === 0) { db.close(); res(out) } } }
    }
  }))
  const reads = () => page.evaluate(() => window.__reads)
  const waitReads = async (fn, label, timeout = 30000) => {
    const ok = await page.waitForFunction(fn, null, { timeout }).then(() => true, () => false)
    await page.waitForTimeout(450)
    if (!ok) console.log(`시간 초과 ${label}`, JSON.stringify(await reads()))
    return ok
  }
  const bar = () => page.getByRole('region', { name: '플레이어' })
  const main = () => page.locator('main')
  const nav = (name) => page.getByRole('navigation', { name: '라이브러리' }).getByRole('link', { name, exact: true }).click()
  const tile = (name) => page.locator('main a[href*="#/albums/"]', { hasText: name }).first()
  const openAlbum = async (name) => { await nav('앨범'); await tile(name).click(); await page.getByRole('heading', { name, level: 1 }).waitFor() }
  const row = (name) => main().locator('ol li', { hasText: name }).locator('button').first()

  // v1 저장소가 있는 상태에서 새 버전으로 업그레이드
  await page.goto(`${url}__blank`)
  await page.evaluate(async (files) => {
    const root = await navigator.storage.getDirectory()
    const lib = await root.getDirectoryHandle('library', { create: true })
    for (const rel of files) {
      const parts = rel.split('/'), name = parts.pop()
      let dir = lib
      for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true })
      const bytes = await (await fetch(`__fx/lib/${rel.split('/').map(encodeURIComponent).join('/')}`)).arrayBuffer()
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
      await w.write(bytes); await w.close()
    }
    await new Promise((res, rej) => {
      const r = indexedDB.open('music-player', 1)
      r.onupgradeneeded = () => r.result.createObjectStore('folders', { keyPath: 'id' })
      r.onerror = rej
      r.onsuccess = () => {
        const tx = r.result.transaction('folders', 'readwrite')
        tx.objectStore('folders').put({ id: 'legacy', name: 'library', handle: lib, addedAt: 1, trackCount: 99, unsupportedCount: 0 })
        tx.oncomplete = () => { r.result.close(); res() }
      }
    })
  }, manifest)
  await page.goto(url, { waitUntil: 'networkidle' })
  const indexed = await waitReads(`window.__reads.read >= ${N}`, '색인')
  const c1 = await dbCounts()
  check('저장소 v1에서 최신으로 업그레이드, 기존 폴더 유지', c1.version === 3 && c1.folders === 1 && c1.tracks !== undefined, JSON.stringify(c1))
  check(`곡 ${N}개를 모두 읽음`, indexed && c1.tracks === N, JSON.stringify(await reads()))

  // 앨범 묶기
  await nav('앨범')
  await tile('유리 온실').waitFor()
  const albumsText = await main().innerText()
  check('앨범 수', albumsText.includes('9개'), albumsText.replace(/\s+/g, ' ').slice(0, 200))
  for (const [album, artist] of [['유리 온실', '밤의 정류장'], ['첫차', '밤의 정류장'], ['오후 세 시', '낮은 구름'], ['Low Tide', 'Paper Harbor'], ['Slow Weather', 'Field Notes'], ['여름 모음', '여러 아티스트'], ['두 장짜리', '서쪽 창'], ['무제', '알 수 없는 아티스트']]) {
    check(`앨범 ${album}: ${artist}`, (await tile(album).innerText()).includes(artist), (await tile(album).innerText()).replace(/\s+/g, ' '))
  }

  // 앨범 상세
  await openAlbum('유리 온실')
  const albumText = (await main().innerText()).replace(/\s+/g, ' ')
  check('연도, 곡 수', albumText.includes('2023년, 3곡'), albumText.slice(0, 120))
  check('포맷: FLAC 96 kHz / 24 bit', albumText.includes('FLAC 96 kHz / 24 bit'))
  check('디스크 구분', albumText.includes('디스크 1') && albumText.includes('디스크 2'))
  const titles = await main().locator('ol li button > span:nth-child(2) > span:first-child').allInnerTexts()
  check('디스크, 트랙 순서', JSON.stringify(titles.slice(0, 3)) === JSON.stringify(['창문을 열면', '새벽 버스', '돌아오는 길']), titles.join(' | '))
  check('곡 길이 표시', albumText.includes('0:02'))
  check('같은 아티스트의 다른 앨범', albumText.includes('밤의 정류장의 다른 앨범') && albumText.includes('첫차'))

  // 앨범 아트
  const artInfo = await page.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('music-player'); r.onsuccess = () => res(r.result) })
    const all = await new Promise((res) => { const q = db.transaction('art').objectStore('art').getAll(); q.onsuccess = () => res(q.result) })
    const sizes = []
    for (const blob of all) { const b = await createImageBitmap(blob); sizes.push(`${b.width}x${b.height}:${blob.type}`) }
    db.close()
    return sizes.sort()
  })
  check('같은 표지는 한 번만 저장', artInfo.length === 4, artInfo.join(' '))
  check('썸네일 크기 (큰 표지 384, 작은 표지 유지, 직사각형은 정사각형)', artInfo.filter((s) => s.startsWith('384x384')).length === 3 && artInfo.includes('200x200:image/jpeg'), artInfo.join(' '))
  const cover = main().locator('img').first()
  check('앨범 화면에 표지 표시', await cover.evaluate((img) => img.complete && img.naturalWidth === 384), await cover.getAttribute('src'))
  await nav('앨범')
  // 썸네일은 저장소에서 비동기로 불러오므로 나타날 때까지 기다린다.
  const shows = (name) => tile(name).locator('img').waitFor({ timeout: 3000 }).then(() => true, () => false)
  check('폴더 이미지(cover.jpg)를 표지로 사용', await shows('Slow Weather'))
  check('상위 폴더 이미지를 표지로 사용 (CD1/CD2)', await shows('두 장짜리'))
  check('표지 없는 앨범은 자리표시', await tile('무제').locator('img').count() === 0)

  // 실제 포맷 재생
  for (const [album, track, label] of [['유리 온실', '창문을 열면', 'FLAC 96 kHz / 24 bit'], ['오후 세 시', '저녁', 'MP3 320 kbps'], ['Low Tide', 'Shore', 'AAC'], ['Slow Weather', 'Rain', 'Opus'], ['Vorbis 앨범', 'Mist', 'Vorbis']]) {
    await openAlbum(album)
    await row(track).click()
    const ok = await page.waitForFunction(() => !window.__audio.paused && window.__audio.currentTime > 0.1, null, { timeout: 4000 }).then(() => true, () => false)
    const barText = (await bar().innerText()).replace(/\s+/g, ' ')
    const state = await page.evaluate(() => ({ t: window.__audio.currentTime.toFixed(2), d: window.__audio.duration.toFixed(2) }))
    check(`재생: ${label}`, ok && barText.includes(track) && barText.includes(label), `${JSON.stringify(state)} ${barText.slice(0, 80)}`)
    await page.keyboard.press('Space').catch(() => {})
    await page.evaluate(() => window.__audio.pause())
  }
  await openAlbum('유리 온실')
  await row('새벽 버스').click()
  await page.waitForFunction(() => document.title.startsWith('새벽 버스'), null, { timeout: 3000 })
  await page.waitForTimeout(300)
  const session = await page.evaluate(() => { const m = navigator.mediaSession.metadata; return { title: m?.title, artist: m?.artist, album: m?.album, art: m?.artwork?.length } })
  check('잠금 화면: 곡 정보와 표지', session.title === '새벽 버스' && session.artist === '밤의 정류장' && session.album === '유리 온실' && session.art === 1, JSON.stringify(session))
  await page.evaluate(() => window.__audio.pause())

  // 태그 없는 파일, 깨진 파일
  await openAlbum('무제')
  const plain = (await main().innerText()).replace(/\s+/g, ' ')
  check('태그 없으면 파일 이름', plain.includes('태그 없는 곡'), plain.slice(0, 100))
  check('깨진 파일도 파일 이름으로 표시', plain.includes('깨짐'))

  // 아티스트, 장르
  await nav('아티스트')
  await page.getByRole('heading', { name: '아티스트', level: 1 }).waitFor()
  await page.waitForTimeout(150)
  const artists = (await main().innerText()).replace(/\s+/g, ' ')
  check('아티스트 목록', artists.includes('밤의 정류장') && artists.includes('앨범 2개, 4곡') && artists.includes('Paper Harbor'), artists.slice(0, 160))
  await main().getByRole('link', { name: /밤의 정류장/ }).click()
  await page.getByRole('heading', { name: '밤의 정류장', level: 1 }).waitFor()
  await page.waitForTimeout(150)
  const artistText = await main().innerText()
  check('아티스트 화면: 앨범 최신순', artistText.indexOf('유리 온실') < artistText.indexOf('첫차') && artistText.includes('첫차'))
  await nav('장르')
  await page.getByRole('heading', { name: '장르', level: 1 }).waitFor()
  await page.waitForTimeout(150)
  const genres = (await main().innerText()).replace(/\s+/g, ' ')
  check('세미콜론 장르 분리', genres.includes('Jazz') && genres.includes('Rock') && !genres.includes('Jazz; Rock'), genres.slice(0, 160))
  await main().getByRole('link', { name: /인디/ }).click()
  await page.getByRole('heading', { name: '인디', level: 1 }).waitFor()
  await page.waitForTimeout(150)
  check('장르 화면: 곡 목록', (await main().innerText()).includes('4곡') && await main().locator('ol li').count() === 4)

  // 즐겨찾기
  await openAlbum('오후 세 시')
  await main().getByRole('button', { name: '즐겨찾기: 저녁' }).click({ force: true })
  await nav('즐겨찾기')
  await page.getByRole('heading', { name: '즐겨찾기', level: 1 }).waitFor()
  await page.waitForTimeout(200)
  check('즐겨찾기 화면에 표시', (await main().innerText()).includes('저녁') && (await dbCounts()).favorites === 1)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  check('새로고침 후 즐겨찾기 유지', (await main().innerText()).includes('저녁'))

  // 캐시: 두 번째 방문
  const warm = await reads()
  check('다시 방문하면 파일을 다시 읽지 않음', warm.read === 0 && warm.unchanged === N, JSON.stringify(warm))

  // 검색
  const search = page.getByRole('searchbox', { name: '검색' }).first()
  await search.fill('새벽')
  await page.waitForTimeout(300)
  const s1 = (await main().innerText()).replace(/\s+/g, ' ')
  check('검색: 곡 제목', page.url().includes('search') && s1.includes('새벽 버스'), s1.slice(0, 120))
  await search.fill('밤의')
  await page.waitForTimeout(300)
  const s2 = (await main().innerText()).replace(/\s+/g, ' ')
  check('검색: 아티스트와 앨범, 곡까지', s2.includes('아티스트') && s2.includes('유리 온실') && s2.includes('출발'), s2.slice(0, 200))
  await search.fill('low tide')
  await page.waitForTimeout(300)
  check('검색: 대소문자 무시', (await main().innerText()).includes('Low Tide'))
  await search.fill('없는단어')
  await page.waitForTimeout(300)
  check('검색: 결과 없음', (await main().innerText()).includes('검색 결과가 없습니다'))
  await search.fill('')
  await page.waitForTimeout(200)
  check('검색: 빈 입력 안내', (await main().innerText()).includes('이름을 입력하세요'))

  // 태그가 바뀐 파일만 다시 읽기
  await page.evaluate(async () => {
    const bytes = await (await fetch('__fx/changed.mp3')).arrayBuffer()
    let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('library')
    for (const p of ['낮은 구름', '오후 세 시']) dir = await dir.getDirectoryHandle(p)
    const w = await (await dir.getFileHandle('02 저녁.mp3')).createWritable()
    await w.write(bytes); await w.close()
    window.__reads = { read: 0, unchanged: 0, unavailable: 0 }
  })
  await page.goto(`${url}#/folders`)
  await main().locator('li', { hasText: 'library' }).getByRole('button', { name: '다시 검색' }).click()
  await waitReads(`window.__reads.read + window.__reads.unchanged >= ${N}`, '다시 검색')
  const changed = await reads()
  check('바뀐 파일 하나만 다시 읽음', changed.read === 1 && changed.unchanged === N - 1, JSON.stringify(changed))
  await openAlbum('오후 세 시')
  check('바뀐 태그 반영', (await main().innerText()).includes('제목이 바뀐 곡'))
  await nav('즐겨찾기')
  await page.waitForTimeout(200)
  check('태그가 바뀌어도 즐겨찾기 유지', (await main().innerText()).includes('제목이 바뀐 곡'))

  // 파일 삭제: 표지까지 정리
  const before = await dbCounts()
  await page.evaluate(async () => {
    let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('library')
    dir = await dir.getDirectoryHandle('Paper Harbor')
    await dir.removeEntry('Low Tide', { recursive: true })
    window.__reads = { read: 0, unchanged: 0, unavailable: 0 }
  })
  await page.goto(`${url}#/folders`)
  await main().locator('li', { hasText: 'library' }).getByRole('button', { name: '다시 검색' }).click()
  await waitReads(`window.__reads.unchanged >= ${N - 1}`, '삭제 후')
  await page.waitForTimeout(400)
  const after = await dbCounts()
  check('지운 파일의 곡 정보와 안 쓰는 표지 삭제', after.tracks === before.tracks - 1 && after.art === before.art - 1, `${JSON.stringify(before)} → ${JSON.stringify(after)}`)
  await nav('앨범')
  await tile('유리 온실').waitFor()
  check('지운 앨범이 목록에서 사라짐', !(await main().innerText()).includes('Low Tide'))

  // 세션 파일
  await page.evaluate(async () => {
    const bytes = await (await fetch('__fx/changed.mp3')).arrayBuffer()
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], '끌어온 곡.mp3', { type: 'audio/mpeg' }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  })
  await page.getByRole('region', { name: '폴더' }).getByRole('link', { name: /가져온 파일/ }).waitFor()
  await page.waitForTimeout(700)
  const dropped = await dbCounts()
  check('끌어온 파일은 태그는 읽되 저장하지 않음', dropped.tracks === after.tracks, JSON.stringify(dropped))

  await page.screenshot({ path: path.join(shots, 'albums-black.jpg'), type: 'jpeg', quality: 88 })
  await openAlbum('유리 온실')
  await row('새벽 버스').click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(shots, 'album-black.jpg'), type: 'jpeg', quality: 88 })
  await page.evaluate(() => window.__audio.pause())
  await nav('아티스트')
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(shots, 'artists-black.jpg'), type: 'jpeg', quality: 88 })
  await page.emulateMedia({ colorScheme: 'light' })
  await nav('앨범')
  await tile('유리 온실').waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'albums-white.jpg'), type: 'jpeg', quality: 88 })
  await page.emulateMedia({ colorScheme: 'dark' })

  // 모바일
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${url}#/albums`, { waitUntil: 'networkidle' })
  await tile('유리 온실').waitFor()
  await page.waitForTimeout(300)
  check('모바일: 2열, 가로 넘침 없음', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('main .grid')?.style.gridTemplateColumns.includes('repeat(2')))
  await page.screenshot({ path: path.join(shots, 'albums-mobile.jpg'), type: 'jpeg', quality: 88 })
  await main().getByRole('link', { name: '검색' }).click()
  await page.getByRole('heading', { name: '검색', level: 1 }).waitFor()
  await page.getByRole('searchbox', { name: '검색' }).fill('출발')
  await page.waitForTimeout(300)
  check('모바일: 검색', (await main().innerText()).includes('출발'))
  await page.setViewportSize({ width: 1440, height: 900 })

  // 폴더 제거: 저장소까지 정리 (끌어온 파일이 표지를 쓰고 있으니 새로고침으로 먼저 비운다)
  await page.goto(`${url}#/folders`)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  await main().locator('li', { hasText: 'library' }).getByRole('button', { name: '제거' }).click()
  await page.waitForTimeout(600)
  const removed = await dbCounts()
  check('폴더를 제거하면 곡 정보, 즐겨찾기, 표지 모두 삭제', removed.folders === 0 && removed.tracks === 0 && removed.favorites === 0 && removed.art === 0, JSON.stringify(removed))

  check('오류 없음 (1부)', problems.filter((p) => !p.includes('no supported source')).length === 0, problems.slice(0, 4).join(' | '))
  await ctx.close()

  // 규모: 앨범 1,000개, 곡 5,000개를 캐시 상태로 넣는다
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  await ctx2.addInitScript(stub)
  const p2 = await ctx2.newPage()
  const errs = []
  p2.on('pageerror', (e) => errs.push(e.message))
  await p2.goto(url, { waitUntil: 'networkidle' })
  await p2.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const base = await root.getDirectoryHandle('large', { create: true })
    const consonants = '가나다라마바사아자차카타파하'
    const records = []
    for (let a = 0; a < 1000; a++) {
      const dir = await base.getDirectoryHandle(`album-${a}`, { create: true })
      const files = await Promise.all(Array.from({ length: 5 }, (_, t) => dir.getFileHandle(`${t + 1}.mp3`, { create: true }).then((h) => h.getFile())))
      files.forEach((f, t) => records.push({ version: 3, id: `large:album-${a}/${t + 1}.mp3`, folderId: 'large', size: f.size, lastModified: f.lastModified, addedAt: a, title: `곡 ${t + 1}`, artist: `${consonants[a % 14]}수 ${a % 200}`, albumArtist: `${consonants[a % 14]}수 ${a % 200}`, album: `앨범 ${a}`, trackNo: t + 1, duration: 200 }))
    }
    await new Promise((res, rej) => {
      const r = indexedDB.open('music-player')
      r.onerror = rej
      r.onsuccess = () => {
        const tx = r.result.transaction(['folders', 'tracks'], 'readwrite')
        tx.objectStore('folders').put({ id: 'large', name: 'large', handle: base, addedAt: 1 })
        for (const rec of records) tx.objectStore('tracks').put(rec)
        tx.oncomplete = () => { r.result.close(); res() }
      }
    })
  })
  const t0 = Date.now()
  await p2.goto(`${url}__blank`)
  await p2.goto(`${url}#/albums`)
  await p2.locator('main a[href*="#/albums/"]').first().waitFor({ timeout: 15000 })
  const firstPaint = Date.now() - t0
  const domTiles = await p2.locator('main a[href*="#/albums/"]').count()
  check('앨범 1,000개: 화면에는 일부만 그림', domTiles > 0 && domTiles < 80, `타일 ${domTiles}개, 첫 표시 ${firstPaint}ms`)
  check('앨범 개수 표시', (await p2.locator('main').innerText()).includes('1,000개'))
  const scrollHeight = await p2.evaluate(() => document.querySelector('main').scrollHeight)
  check('전체 높이는 1,000개 기준', scrollHeight > 30000, String(scrollHeight))

  const rail = p2.getByRole('navigation', { name: '첫 글자로 이동' })
  check('인덱스: 있는 초성만 표시', await rail.getByRole('button').count() === 14, (await rail.innerText()).replace(/\s+/g, ' '))
  await rail.getByRole('button', { name: 'ㅎ(으)로 이동' }).click()
  await p2.waitForTimeout(500)
  const firstRow = await p2.evaluate(() => {
    const main = document.querySelector('main').getBoundingClientRect()
    const tiles = [...document.querySelectorAll('main a[href*="#/albums/"]')].filter((a) => a.getBoundingClientRect().top >= main.top - 2)
    const top = Math.min(...tiles.map((a) => a.getBoundingClientRect().top))
    return tiles.filter((a) => Math.abs(a.getBoundingClientRect().top - top) < 2).map((a) => a.innerText.replace(/\s+/g, ' '))
  })
  check('인덱스 ㅎ을 누르면 ㅎ이 시작하는 줄로 이동', firstRow.some((t) => t.includes('하수')) && firstRow.some((t) => t.includes('파수')), firstRow.join(' / '))

  // 뒤로 가면 보던 자리
  const scrolled = await p2.evaluate(() => document.querySelector('main').scrollTop)
  await p2.locator('main a[href*="#/albums/"]').nth(8).click()
  await p2.getByRole('heading', { level: 1 }).waitFor()
  await p2.waitForTimeout(200)
  const topOfAlbum = await p2.evaluate(() => document.querySelector('main').scrollTop)
  await p2.goBack()
  await p2.waitForTimeout(500)
  const restored = await p2.evaluate(() => document.querySelector('main').scrollTop)
  check('상세 화면은 맨 위에서 시작', topOfAlbum === 0, String(topOfAlbum))
  check('뒤로 가면 보던 자리로', Math.abs(restored - scrolled) < 3, `${scrolled} → ${restored}`)

  // 정렬 유지
  await p2.getByRole('combobox', { name: '정렬' }).selectOption('recent')
  await p2.waitForTimeout(200)
  check('최근 추가순이면 인덱스 숨김', await rail.count() === 0)
  await p2.reload({ waitUntil: 'networkidle' })
  await p2.locator('main a[href*="#/albums/"]').first().waitFor({ timeout: 15000 })
  check('정렬 저장', await p2.getByRole('combobox', { name: '정렬' }).inputValue() === 'recent')
  check('최근 추가순 첫 앨범', (await p2.locator('main a[href*="#/albums/"]').first().innerText()).includes('앨범 999'))

  // 5,000곡 폴더 목록
  await p2.goto(`${url}#/folders/large`, { waitUntil: 'networkidle' })
  await p2.locator('main ol li').first().waitFor({ timeout: 10000 })
  const rows = await p2.locator('main ol li').count()
  check('5,000곡 목록: 화면에는 일부만 그림', rows > 0 && rows < 60, `${rows}개`)
  await p2.evaluate(() => { const m = document.querySelector('main'); m.scrollTop = m.scrollHeight })
  await p2.waitForTimeout(300)
  check('5,000곡 목록: 끝까지 스크롤', (await p2.locator('main ol li').last().innerText()).includes('곡 5'), (await p2.locator('main ol li').last().innerText()).replace(/\s+/g, ' '))
  check('규모 시험 오류 없음', errs.length === 0, errs.slice(0, 3).join(' | '))
  await ctx2.close()

  // 태그 읽기 속도와 화면 멈춤: 실제 MP3 1,000개
  const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  await ctx3.addInitScript(stub)
  const p3 = await ctx3.newPage()
  await p3.goto(url, { waitUntil: 'networkidle' })
  await p3.evaluate(async () => {
    const bytes = await (await fetch('__fx/changed.mp3')).arrayBuffer()
    const root = await navigator.storage.getDirectory()
    const base = await root.getDirectoryHandle('speed', { create: true })
    for (let a = 0; a < 100; a++) {
      const dir = await base.getDirectoryHandle(`d${a}`, { create: true })
      await Promise.all(Array.from({ length: 10 }, async (_, t) => {
        const w = await (await dir.getFileHandle(`${t}.mp3`, { create: true })).createWritable()
        await w.write(bytes); await w.close()
      }))
    }
    localStorage.setItem('t:pick', 'speed')
    window.__long = []
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__long.push(Math.round(e.duration)) }).observe({ entryTypes: ['longtask'] })
  })
  const started = Date.now()
  await p3.getByRole('region', { name: '폴더' }).getByRole('button', { name: '폴더 추가' }).click()
  await p3.waitForFunction(() => window.__reads.read >= 1000, null, { timeout: 120000 })
  const elapsed = Date.now() - started
  await p3.waitForTimeout(500)
  const long = await p3.evaluate(() => window.__long)
  const worst = Math.max(0, ...long)
  check('MP3 1,000개 읽기', elapsed < 60000, `${elapsed}ms, 곡당 ${(elapsed / 1000).toFixed(1)}ms`)
  check('읽는 동안 화면이 멈추지 않음 (가장 긴 작업 200ms 미만)', worst < 200, `긴 작업 ${long.length}회, 최대 ${worst}ms`)
  await ctx3.close()

  await browser.close()
  server.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
