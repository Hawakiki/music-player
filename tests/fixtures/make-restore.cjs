// 무손실 원본을 여러 코덱으로 압축해서 고역 복원 시험 파일을 만든다. 원본은 읽기만 한다.
// usage: node make-restore.cjs <songFolder> <outDir>
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const [folder, out] = process.argv.slice(2)
if (!folder || !out) throw new Error('usage: node make-restore.cjs <songFolder> <outDir>')
const SONGS = [
  { key: 'life', file: 'Oliver Tree - Life Goes On.flac', start: 40 },
  { key: 'boen', file: 'Bo En - My Time.flac', start: 60 },
]
const SECONDS = 30
const VARIANTS = [
  ['mp3-96', 'mp3', ['-c:a', 'libmp3lame', '-b:a', '96k']],
  ['mp3-128', 'mp3', ['-c:a', 'libmp3lame', '-b:a', '128k']],
  ['mp3-192', 'mp3', ['-c:a', 'libmp3lame', '-b:a', '192k']],
  ['mp3-256', 'mp3', ['-c:a', 'libmp3lame', '-b:a', '256k']],
  ['mp3-320', 'mp3', ['-c:a', 'libmp3lame', '-b:a', '320k']],
  ['mp3-v2', 'mp3', ['-c:a', 'libmp3lame', '-q:a', '2']],
  ['aac-128', 'm4a', ['-c:a', 'aac', '-b:a', '128k']],
  ['aac-256', 'm4a', ['-c:a', 'aac', '-b:a', '256k']],
  ['ogg-q4', 'ogg', ['-c:a', 'libvorbis', '-q:a', '4']],
  ['opus-96', 'opus', ['-c:a', 'libopus', '-b:a', '96k']],
]

const ff = (...args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${args.join(' ')}\n${r.stderr}`)
}

fs.mkdirSync(out, { recursive: true })
for (const { key, file, start } of SONGS) {
  const source = path.join(folder, file)
  const original = path.join(out, `${key}-original.flac`)
  if (!fs.existsSync(original)) ff('-ss', String(start), '-t', String(SECONDS), '-i', source, '-c:a', 'flac', original)
  for (const [name, ext, codec] of VARIANTS) {
    const target = path.join(out, `${key}-${name}.${ext}`)
    if (!fs.existsSync(target)) ff('-i', original, ...codec, target)
  }
  // 잘린 음원을 무손실로 포장한 가짜 FLAC
  const fake = path.join(out, `${key}-fake-flac.flac`)
  if (!fs.existsSync(fake)) ff('-i', path.join(out, `${key}-mp3-128.mp3`), '-c:a', 'flac', fake)
}
// 곡이 아닌 소리
const tone = path.join(out, 'zz-sine-1k.flac')
if (!fs.existsSync(tone)) ff('-f', 'lavfi', '-i', 'sine=frequency=1000:duration=10:sample_rate=48000', '-c:a', 'flac', tone)
const quiet = path.join(out, 'zz-silence.flac')
if (!fs.existsSync(quiet)) ff('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=10', '-c:a', 'flac', quiet)
const dark = path.join(out, 'zz-dark-noise.flac')
if (!fs.existsSync(dark)) ff('-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.3:duration=10:sample_rate=48000', '-af', 'lowpass=f=6000', '-c:a', 'flac', dark)
const full = path.join(out, 'zz-full-noise.flac')
if (!fs.existsSync(full)) ff('-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.3:duration=10:sample_rate=48000', '-c:a', 'flac', full)
console.log(fs.readdirSync(out).length, 'files')
