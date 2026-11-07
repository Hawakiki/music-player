// 브라우저 시험을 차례로 돌린다. 음원은 저장소에 두지 않고 곡 폴더를 인자로 받는다.
// usage: node tests/run.mjs --songs <곡 폴더> [--dist dist] [--only 8,16] [--long <아주 긴 파일>]
// 필요: ffmpeg, Edge, Chrome(verify19). 시험 파일과 캡처는 tests/out에 생긴다.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(here, 'out')
const fixtures = path.join(out, 'fixtures')

/** 곡 폴더에 있어야 하는 곡. 실제 곡으로만 드러나는 문제가 있어서 합성음으로 대신하지 않는다. */
const SONGS = [
  'Oliver Tree - Life Goes On.flac',
  'Bo En - My Time.flac',
  'Frank Sinatra - My Way (2008 Remastered).flac',
  'Jamiroquai - Virtual Insanity (Remastered 2013).flac',
]

function readArgs(argv) {
  const args = { dist: 'dist' }
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index].replace(/^--/, '')
    args[key] = argv[index + 1]
  }
  return args
}

const args = readArgs(process.argv.slice(2))
const dist = path.resolve(args.dist)
const songs = args.songs && path.resolve(args.songs)
const only = args.only ? new Set(args.only.split(',').map(Number)) : null

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error(`${dist}에 빌드가 없습니다. npm run build를 먼저 하세요.`)
  process.exit(1)
}
const missing = songs ? SONGS.filter((name) => !fs.existsSync(path.join(songs, name))) : SONGS
if (missing.length > 0) {
  console.error(`--songs 폴더에 이 곡들이 있어야 합니다:\n${missing.map((name) => `  ${name}`).join('\n')}`)
  process.exit(1)
}
const life = path.join(songs, SONGS[0])

function makeFixtures(script, scriptArgs) {
  console.log(`시험 파일 만드는 중: ${script}`)
  const result = spawnSync(process.execPath, [path.join(here, 'fixtures', script), ...scriptArgs], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(1)
}

fs.mkdirSync(fixtures, { recursive: true })
if (!fs.existsSync(path.join(fixtures, 'manifest.json'))) makeFixtures('make-library.cjs', [fixtures])
if (!fs.existsSync(path.join(fixtures, 'restore'))) makeFixtures('make-restore.cjs', [songs, path.join(fixtures, 'restore')])
if (!fs.existsSync(path.join(fixtures, 'codec'))) makeFixtures('make-formats.cjs', [life, fixtures])

const tape = path.join(fixtures, 'tape')
const codec = path.join(fixtures, 'codec')
const TESTS = [
  { number: 1, args: [] },
  { number: 2, args: [] },
  { number: 3, args: [] },
  { number: 4, args: [] },
  { number: 5, args: [] },
  { number: 6, args: [] },
  { number: 7, args: [songs] },
  { number: 8, args: [] },
  { number: 9, args: [] },
  { number: 10, args: [songs] },
  { number: 11, args: [songs] },
  { number: 12, args: [songs] },
  { number: 13, args: [life] },
  { number: 14, args: [songs] },
  // 효과를 켠 측정 화면은 프레임 간격에 따라 드러나는 문제가 달라서 간격을 바꿔 한 번 더 돈다.
  { number: 14, label: '15ms', args: [songs], env: { FRAME_MS: '15' } },
  ...(args.long ? [{ number: 15, args: [path.resolve(args.long)] }] : []),
  { number: 16, label: 'desktop', args: [songs, 'desktop', 'dark'] },
  { number: 16, label: 'phone', args: [songs, 'phone', 'light'] },
  { number: 17, label: 'desktop', args: [songs, 'desktop', 'dark'] },
  { number: 17, label: 'phone', args: [songs, 'phone', 'dark'] },
  { number: 18, args: [tape, 'desktop', 'dark'] },
  { number: 19, label: 'edge', args: [codec, 'desktop', 'dark'], env: { CHANNEL: 'msedge' } },
  { number: 19, label: 'chrome', args: [codec, 'desktop', 'dark'], env: { CHANNEL: 'chrome' } },
]

const log = []
const failed = []
for (const test of TESTS) {
  if (only && !only.has(test.number)) continue

  const name = [`verify${test.number}`, test.label].filter(Boolean).join(' ')
  const shots = path.join(out, 'shots', name.replace(' ', '-'))
  console.log(`=== ${name}`)
  const result = spawnSync(
    process.execPath,
    [path.join(here, 'e2e', `verify${test.number}.cjs`), dist, shots, ...test.args],
    { encoding: 'utf8', env: { ...process.env, ...test.env }, maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60 * 1000 },
  )
  const output = `${result.stdout}${result.stderr}`
  const lines = output.split('\n').filter((line) => /FAIL|passed|Error|Timeout/.test(line))
  for (const line of lines) console.log(line)
  log.push(`=== ${name}`, ...lines)

  const passed = lines.some((line) => /\d+ passed, 0 failed/.test(line))
  if (!passed || result.status !== 0) failed.push(name)
}

fs.writeFileSync(path.join(out, 'regression.log'), `${log.join('\n')}\n`)
console.log(failed.length > 0 ? `\n실패: ${failed.join(', ')}` : '\n모두 통과')
process.exit(failed.length > 0 ? 1 : 0)
