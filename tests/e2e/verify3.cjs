// 3단계 검증: 실제로 소리가 나는 WAV 파일을 만들어서 재생한다.
// usage: node verify3.cjs <distDir> <shotDir>
const http = require('node:http')
const fs = require('node:fs')
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

const stub = () => {
  try {
    window.showDirectoryPicker = async () => {
      let dir = await navigator.storage.getDirectory()
      for (const part of localStorage.getItem('t:pick').split('/')) dir = await dir.getDirectoryHandle(part)
      return dir
    }
    FileSystemHandle.prototype.queryPermission = async function () { return localStorage.getItem('t:query') || 'granted' }
    FileSystemHandle.prototype.requestPermission = async function () { return 'granted' }
    const NativeAudio = window.Audio
    window.Audio = function (...args) { const el = new NativeAudio(...args); window.__audio = el; return el }
  } catch {}
}

;(async () => {
  fs.mkdirSync(shots, { recursive: true })
  await new Promise((r) => server.listen(4176, r))
  const url = `http://localhost:4176${BASE}`
  const browser = await chromium.launch({ channel: 'msedge' })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  await ctx.addInitScript(stub)
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`) })
  await page.goto(url, { waitUntil: 'networkidle' })

  // 오디오 파일 만들기
  await page.evaluate(async () => {
    const wav = (seconds, freq) => {
      const rate = 8000, n = Math.floor(rate * seconds), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
      const s = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
      s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
      v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 2, true)
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * freq * i / rate) * 8000, true)
      return buf
    }
    const root = await navigator.storage.getDirectory()
    const put = async (folder, name, data) => {
      const dir = await root.getDirectoryHandle(folder, { create: true })
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
      await w.write(data); await w.close()
    }
    const junk = new Uint8Array(4000).map((_, i) => (i * 37) % 251)
    await put('테스트', '01 하나.wav', wav(1.2, 330))
    await put('테스트', '02 둘.wav', wav(1.2, 440))
    await put('테스트', '03 셋.wav', wav(1.2, 550))
    await put('테스트', '04 긴 곡.wav', wav(30, 660))
    await put('깨진 파일', 'a 깨짐.mp3', junk)
    await put('깨진 파일', 'b 깨짐.flac', junk)
    await put('깨진 파일', 'c 정상.wav', wav(5, 440))
    await put('전부 깨짐', 'x.mp3', junk)
    await put('전부 깨짐', 'y.mp3', junk)
    await put('전부 깨짐', 'z.mp3', junk)
  })

  const opt = (k, v) => page.evaluate(([a, b]) => (b === null ? localStorage.removeItem(a) : localStorage.setItem(a, b)), [k, v])
  const side = () => page.getByRole('region', { name: '폴더' })
  const bar = () => page.getByRole('region', { name: '플레이어' })
  const queue = () => page.getByRole('complementary', { name: '대기열' })
  const notice = () => page.getByRole('status').innerText()
  const audio = () => page.evaluate(() => { const a = window.__audio; return { paused: a.paused, time: a.currentTime, duration: a.duration, hasSrc: a.hasAttribute('src'), volume: a.volume, muted: a.muted } })
  const titleIs = (t, timeout = 6000) => page.waitForFunction((x) => document.title.startsWith(`${x} - `), t, { timeout }).then(() => true, () => false)
  const playing = (timeout = 3000) => page.waitForFunction(() => !window.__audio.paused && window.__audio.currentTime > 0.05, null, { timeout }).then(() => true, () => false)
  const row = (name) => page.locator('main ol li', { hasText: name }).locator('button').first()
  const btn = (name) => bar().getByRole('button', { name, exact: true })
  const addFolder = async (name) => {
    await opt('t:pick', name)
    await side().getByRole('button', { name: '폴더 추가' }).click()
    await side().getByRole('link', { name: new RegExp(name) }).filter({ hasText: '곡' }).waitFor()
  }
  const open = async (name) => { await side().getByRole('link', { name: new RegExp(name) }).click(); await page.getByRole('heading', { name, level: 1 }).waitFor() }
  const seekEnd = async () => { await page.getByRole('slider', { name: '재생 위치' }).focus(); await page.keyboard.press('End') }
  const seekTo = (s) => page.evaluate((t) => { window.__audio.currentTime = t }, s)

  // 기본 재생
  check('곡이 없으면 재생 버튼 비활성', await btn('재생').isDisabled() && (await bar().innerText()).includes('재생 중인 곡 없음'))
  await addFolder('테스트')
  await open('테스트')
  await row('02 둘').click()
  check('곡을 누르면 재생', await titleIs('02 둘') && await playing())
  const first = await audio()
  check('길이를 읽음', Math.abs(first.duration - 1.2) < 0.05, String(first.duration))
  check('플레이어 막대 제목', (await bar().innerText()).includes('02 둘'))
  check('목록에 재생 중 표시', await page.locator('main ol li', { hasText: '02 둘' }).getByLabel('재생 중').count() === 1)
  const q = await queue().innerText()
  check('대기열: 다음 곡 2개', q.includes('다음 곡 2개') && q.includes('03 셋') && q.includes('04 긴 곡') && !q.includes('01 하나'), q.replace(/\s+/g, ' '))
  check('잠금 화면 정보', await page.evaluate(() => navigator.mediaSession.metadata?.title === '02 둘' && navigator.mediaSession.playbackState === 'playing'))

  // 일시정지
  await row('04 긴 곡').click()
  await titleIs('04 긴 곡'); await playing()
  await btn('일시정지').click()
  await page.waitForTimeout(150)
  const pausedAt = await audio()
  check('일시정지', pausedAt.paused)
  check('잠금 화면 상태도 일시정지', await page.evaluate(() => navigator.mediaSession.playbackState === 'paused'))
  await btn('재생').click()
  check('다시 재생', await playing())
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('Space')
  await page.waitForTimeout(150)
  const spaced = await audio()
  check('스페이스로 일시정지, 곡이 처음으로 안 돌아감', spaced.paused && spaced.time >= pausedAt.time, `${spaced.time}`)
  await page.keyboard.press('Space')
  check('스페이스로 다시 재생', await playing())
  await seekTo(10); await page.waitForTimeout(100)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(100)
  check('오른쪽 화살표로 앞으로 5초', (await audio()).time > 14.5, String((await audio()).time))

  // 이전, 다음
  await btn('이전 곡').click()
  await page.waitForTimeout(150)
  check('3초 넘게 들었으면 이전은 처음으로', (await audio()).time < 1 && await titleIs('04 긴 곡', 500))
  await btn('이전 곡').click()
  check('3초 안이면 이전 곡으로', await titleIs('03 셋'))
  await btn('다음 곡').click()
  check('다음 곡', await titleIs('04 긴 곡'))
  check('마지막 곡이면 다음 버튼 비활성', await btn('다음 곡').isDisabled())

  // 자동으로 다음 곡
  await row('01 하나').click()
  check('끝나면 다음 곡 1', await titleIs('02 둘'))
  check('끝나면 다음 곡 2', await titleIs('03 셋'))
  check('끝나면 다음 곡 3', await titleIs('04 긴 곡'))

  // 대기열 끝
  await playing(); await seekEnd()
  await page.waitForFunction(() => window.__audio.paused && window.__audio.currentTime === 0, null, { timeout: 4000 }).catch(() => {})
  const ended = await audio()
  check('마지막 곡이 끝나면 처음 위치에 멈춤', ended.paused && ended.time === 0 && await titleIs('04 긴 곡', 500), JSON.stringify(ended))
  check('끝난 뒤 재생 버튼 표시', await btn('재생').isEnabled())

  // 반복
  await bar().getByRole('button', { name: '반복 끔' }).click()
  check('다음 곡 버튼: 전체 반복이면 활성', await btn('다음 곡').isEnabled())
  await btn('재생').click(); await playing(); await seekEnd()
  check('전체 반복: 끝에서 처음으로', await titleIs('01 하나'))
  await bar().getByRole('button', { name: '전체 반복' }).click()
  await row('01 하나').click(); await playing()
  await page.waitForFunction(() => window.__audio.currentTime > 0.9, null, { timeout: 3000 })
  await page.waitForFunction(() => window.__audio.currentTime < 0.5 && !window.__audio.paused, null, { timeout: 4000 }).catch(() => {})
  const loop = await audio()
  check('한 곡 반복: 같은 곡을 다시', loop.time < 1 && !loop.paused && await titleIs('01 하나', 500), JSON.stringify(loop))
  await bar().getByRole('button', { name: '한 곡 반복' }).click()

  // 셔플
  await row('02 둘').click(); await titleIs('02 둘')
  await bar().getByRole('button', { name: '셔플' }).click()
  await page.waitForTimeout(100)
  const shuffledText = await queue().innerText()
  check('셔플 켜기: 지금 곡 유지, 나머지 3곡', shuffledText.includes('다음 곡 3개') && await titleIs('02 둘', 300) && !(await audio()).paused, shuffledText.replace(/\s+/g, ' '))
  await bar().getByRole('button', { name: '셔플' }).click()
  await page.waitForTimeout(100)
  check('셔플 끄기: 원래 순서', (await queue().innerText()).includes('다음 곡 2개'))
  await page.getByRole('button', { name: '셔플', exact: true }).first().click()
  await page.waitForTimeout(200)
  check('폴더 셔플 버튼', await bar().getByRole('button', { name: '셔플' }).getAttribute('aria-pressed') === 'true' && (await queue().innerText()).includes('다음 곡 3개'))
  await bar().getByRole('button', { name: '셔플' }).click()

  // 대기열 조작
  await row('01 하나').click(); await titleIs('01 하나')
  await page.locator('main ol li', { hasText: '02 둘' }).getByRole('button', { name: /더 보기/ }).click({ force: true })
  await page.getByRole('menuitem', { name: '대기열에 추가' }).click()
  await page.waitForTimeout(100)
  check('대기열에 추가', (await queue().innerText()).includes('다음 곡 4개') && (await notice()).includes('대기열에 추가했습니다'), await notice())
  await queue().getByRole('button', { name: '대기열에서 제거: 03 셋' }).click({ force: true })
  await page.waitForTimeout(100)
  check('대기열에서 제거', !(await queue().innerText()).includes('03 셋'))
  await queue().getByRole('button', { name: /04 긴 곡/ }).first().click()
  check('대기열 곡을 누르면 이동', await titleIs('04 긴 곡'))
  await queue().getByRole('button', { name: '비우기' }).click()
  await page.waitForTimeout(100)
  check('비우기: 지금 곡은 유지', !(await queue().innerText()).includes('다음 곡') && await titleIs('04 긴 곡', 300))

  // 볼륨
  const volume = page.getByRole('slider', { name: '볼륨' })
  await volume.focus(); await page.keyboard.press('Home')
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(100)
  check('볼륨 조절', Math.abs((await audio()).volume - 0.4) < 0.001, String((await audio()).volume))
  await btn('음소거').click()
  check('음소거', (await audio()).muted)
  await page.getByRole('button', { name: '음소거 해제' }).click()
  check('음소거 해제', !(await audio()).muted && Math.abs((await audio()).volume - 0.4) < 0.001)

  // 이어 듣기
  await open('테스트')
  await row('04 긴 곡').click(); await titleIs('04 긴 곡'); await playing()
  await seekTo(12); await page.waitForTimeout(400)
  await btn('일시정지').click(); await page.waitForTimeout(150)
  await page.reload({ waitUntil: 'networkidle' })
  const restored = await titleIs('04 긴 곡')
  await page.waitForFunction(() => window.__audio.currentTime > 5, null, { timeout: 4000 }).catch(() => {})
  const after = await audio()
  check('새로고침: 곡과 위치 복원, 자동 재생 안 함', restored && after.paused && Math.abs(after.time - 12) < 1, JSON.stringify(after))
  check('새로고침: 볼륨 복원', Math.abs(after.volume - 0.4) < 0.001)
  check('새로고침: 대기열 복원', (await queue().innerText()).includes('04 긴 곡'))
  await btn('재생').click()
  check('복원된 위치에서 이어서 재생', await playing() && (await audio()).time > 11)

  // 재생할 수 없는 파일
  await addFolder('깨진 파일'); await open('깨진 파일')
  await row('a 깨짐').click()
  check('깨진 파일은 건너뜀', await titleIs('c 정상') && await playing())
  check('건너뛰면 안내', (await notice()).includes('재생할 수 없는 파일입니다'), await notice())
  await addFolder('전부 깨짐'); await open('전부 깨짐')
  await row('x').click()
  await page.waitForFunction(() => !window.__audio.hasAttribute('src'), null, { timeout: 6000 }).catch(() => {})
  await page.waitForTimeout(600)
  const dead = await audio()
  check('전부 깨졌으면 멈춤', dead.paused && !dead.hasSrc, JSON.stringify(dead))
  check('멈춘 이유 안내', (await notice()).includes('연속으로 재생하지 못해'), await notice())
  check('멈춘 뒤 재생 표시', await btn('재생').isEnabled())

  // 파일이 지워짐
  await open('테스트')
  await row('01 하나').click(); await titleIs('01 하나')
  await page.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('테스트'); await d.removeEntry('02 둘.wav') })
  check('지워진 파일은 건너뜀', await titleIs('03 셋'))

  // 권한이 사라짐
  await page.evaluate(() => {
    window.__getFile = FileSystemFileHandle.prototype.getFile
    FileSystemFileHandle.prototype.getFile = async () => { throw new DOMException('no', 'NotAllowedError') }
  })
  await opt('t:query', 'prompt')
  await row('04 긴 곡').click()
  await side().getByRole('button', { name: '다시 연결' }).waitFor({ timeout: 4000 }).catch(() => {})
  check('권한이 사라지면 멈추고 다시 연결 표시', (await audio()).paused && await side().getByRole('button', { name: '다시 연결' }).count() === 1)
  await page.evaluate(() => { FileSystemFileHandle.prototype.getFile = window.__getFile })
  await opt('t:query', null)
  await side().getByRole('button', { name: '다시 연결' }).click()
  await side().getByRole('link', { name: /테스트/ }).filter({ hasText: '3곡' }).waitFor({ timeout: 4000 })

  // 곡을 빠르게 바꿈
  await open('테스트')
  await page.evaluate(() => { const b = [...document.querySelectorAll('main ol li button:first-child')]; for (const i of [0, 1, 2, 0, 2, 1]) b[i].click() })
  // 마지막으로 누른 곡은 목록의 두 번째(03 셋)다. 늦게 끝난 이전 로드가 덮어쓰면 소리가 다른 곡이 된다.
  await page.waitForTimeout(250)
  const raced = await page.evaluate(async () => {
    const a = window.__audio
    const bytes = await (await fetch(a.src)).arrayBuffer()
    return { title: document.title, paused: a.paused, size: bytes.byteLength, duration: a.duration }
  })
  check('빠르게 눌러도 마지막에 누른 곡이 재생', raced.title.startsWith('03 셋') && !raced.paused, JSON.stringify(raced))
  check('제목과 실제 재생 파일이 일치', Math.abs(raced.duration - 1.2) < 0.05 && raced.size === 19244, `${raced.size} bytes`)

  await page.screenshot({ path: path.join(shots, 'player-black.jpg'), type: 'jpeg', quality: 88 })

  // 재생 중 폴더 제거
  await page.goto(`${url}#/folders`)
  await page.locator('main li', { hasText: '테스트' }).getByRole('button', { name: '제거' }).click()
  await page.waitForTimeout(300)
  const removedText = await bar().innerText()
  check('재생 중인 폴더를 제거하면 그 곡이 멈춤', !removedText.includes('04 긴 곡') && !removedText.includes('03 셋') && !removedText.includes('01 하나'), removedText.replace(/\s+/g, ' ').slice(0, 60))

  // 모바일
  await addFolder('깨진 파일').catch(() => {})
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${url}#/folders`, { waitUntil: 'networkidle' })
  await page.locator('main li', { hasText: '깨진 파일' }).getByRole('link').click()
  await page.getByRole('heading', { name: '깨진 파일', level: 1 }).waitFor()
  await row('c 정상').click(); await titleIs('c 정상'); await playing()
  check('모바일: 탐색바 표시', await page.getByRole('slider', { name: '재생 위치' }).count() === 1)
  check('모바일: 가로 넘침 없음', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: path.join(shots, 'player-mobile.jpg'), type: 'jpeg', quality: 88 })
  await bar().getByRole('link', { name: '대기열' }).click()
  await page.getByRole('heading', { name: '대기열', level: 1 }).waitFor()
  check('모바일: 대기열 화면으로 이동', (await page.locator('main').innerText()).includes('c 정상'))

  // 치명적이지 않은 재생 실패 로그는 브라우저가 남기므로 앱 오류만 본다
  const real = problems.filter((p) => !p.includes('Failed to load because no supported source') && !p.includes('MEDIA_ELEMENT_ERROR'))
  check('앱 오류 없음', real.length === 0, real.slice(0, 4).join(' | '))

  await browser.close()
  server.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
