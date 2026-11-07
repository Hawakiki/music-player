// 원본 곡 하나를 잘라 여러 규격과 코덱으로 만든다. 카세트 테이프 규격과 재생 불가 코덱 시험에 쓴다.
// usage: node make-formats.cjs <sourceSong> <outDir>
// 만든 파일은 <outDir>/tape, <outDir>/codec에 들어간다. 원본은 읽기만 한다.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const [source, out] = process.argv.slice(2)
if (!source || !out) throw new Error('usage: node make-formats.cjs <sourceSong> <outDir>')

const START = '30'
// FLAC과 WavPack은 앞을 잘라 낸 입력에서 블록 크기를 잘못 잡아 실패하므로 크기를 정해 준다.
const FRAME = ['-frame_size', '4096']

const ff = (seconds, file, args) => {
  const r = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', '-ss', START, '-t', String(seconds), '-i', source, '-map', '0:a', '-map_metadata', '-1', ...args, file],
    { encoding: 'utf8' },
  )
  if (r.status !== 0) throw new Error(`ffmpeg 실패: ${path.basename(file)}\n${r.stderr}`)
}

const tags = (entries, stream = false) =>
  Object.entries(entries).flatMap(([key, value]) => [stream ? '-metadata:s:a:0' : '-metadata', `${key}=${value}`])

// 테이프 규격. 앨범 태그를 영문으로 둔다. WAV 태그의 한글은 깨져서 다른 앨범으로 빠진다.
const TAPE = [
  ['보통 MP3', 'mp3', ['-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k']],
  ['보통 Opus', 'opus', ['-c:a', 'libopus', '-b:a', '128k'], true],
  ['CD FLAC', 'flac', ['-ar', '44100', '-c:a', 'flac', '-sample_fmt', 's16', ...FRAME]],
  ['고해상도 FLAC', 'flac', ['-ar', '96000', '-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24', ...FRAME]],
  ['모노 MP3', 'mp3', ['-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k']],
  ['5.1 FLAC', 'flac', ['-ar', '48000', '-ac', '6', '-c:a', 'flac', '-sample_fmt', 's16', ...FRAME]],
  ['22kHz MP3', 'mp3', ['-ar', '22050', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '64k']],
  ['8bit WAV', 'wav', ['-ar', '44100', '-c:a', 'pcm_u8']],
  ['32bit float WAV', 'wav', ['-ar', '48000', '-c:a', 'pcm_f32le']],
  ['384kHz FLAC', 'flac', ['-ar', '384000', '-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24', ...FRAME]],
  ['AAC 스트림', 'aac', ['-c:a', 'aac', '-b:a', '128k', '-write_id3v2', '1']],
  ['Ogg 오디오', 'oga', ['-c:a', 'libvorbis', '-q:a', '4']],
  // WebM은 앨범 태그를 읽지 못해 폴더 이름 앨범으로 빠진다. 시험도 그렇게 본다.
  ['WebM 오디오', 'weba', ['-c:a', 'libopus', '-b:a', '128k', '-f', 'webm']],
]

const tape = path.join(out, 'tape')
fs.rmSync(tape, { recursive: true, force: true })
fs.mkdirSync(tape, { recursive: true })
TAPE.forEach(([title, ext, args, streamTags], index) => {
  const track = index + 1
  const file = path.join(tape, `${String(track).padStart(2, '0')}-${title}.${ext}`)
  ff(20, file, [...args, ...tags({ title, album: 'Format Test', artist: 'Format', track }, streamTags)])
})

// 재생 가능 여부. x-로 시작하는 파일은 Chrome과 Edge 모두 재생하지 못한 코덱이다.
// AC-3는 Edge만 재생한다. aif와 wma는 확장자로 빠진다. 제목은 x-를 뺀 파일 이름이다.
const CODEC = [
  ['plain.mp3', ['-c:a', 'libmp3lame', '-b:a', '192k']],
  ['opus.mka', ['-c:a', 'libopus', '-b:a', '128k']],
  ['flac.mka', ['-c:a', 'flac', ...FRAME]],
  ['aac-in.m4b', ['-c:a', 'aac', '-b:a', '128k', '-f', 'ipod']],
  ['ac3.mka', ['-c:a', 'ac3', '-b:a', '192k']],
  ['mulaw.wav', ['-c:a', 'pcm_mulaw']],
  ['s32.wav', ['-c:a', 'pcm_s32le']],
  ['aiff-16.aif', ['-c:a', 'pcm_s16be']],
  ['wma.wma', ['-c:a', 'wmav2', '-b:a', '128k']],
  ['x-adpcm.wav', ['-c:a', 'adpcm_ms']],
  ['x-ima.wav', ['-c:a', 'adpcm_ima_wav']],
  ['x-gsm.wav', ['-c:a', 'libgsm_ms', '-ar', '8000', '-ac', '1']],
  ['x-f64.wav', ['-c:a', 'pcm_f64le']],
  ['x-alac.m4a', ['-c:a', 'alac']],
  ['x-alac.m4b', ['-c:a', 'alac', '-f', 'ipod']],
  ['x-alac.mka', ['-c:a', 'alac']],
  ['x-dts.mka', ['-c:a', 'dca', '-strict', '-2', '-ar', '48000']],
  ['x-mp2.mka', ['-c:a', 'mp2', '-b:a', '192k']],
  ['x-truehd.mka', ['-c:a', 'truehd', '-strict', '-2']],
  ['x-speex.oga', ['-c:a', 'libspeex', '-ar', '16000', '-ac', '1', '-f', 'ogg']],
]

const codec = path.join(out, 'codec')
fs.rmSync(codec, { recursive: true, force: true })
fs.mkdirSync(codec, { recursive: true })
for (const [name, args] of CODEC) {
  ff(6, path.join(codec, name), [...args, ...tags({ title: name.replace(/^x-/, '') })])
}

console.log(`tape ${fs.readdirSync(tape).length}개, codec ${fs.readdirSync(codec).length}개`)
