// 태그와 앨범 아트가 들어간 합성 라이브러리를 ffmpeg로 만든다. 소리는 사인파라 음원이 필요 없다.
// usage: node make-library.cjs <outDir>
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const [out] = process.argv.slice(2)
if (!out) throw new Error('usage: node make-library.cjs <outDir>')
const lib = path.join(out, 'lib')
// 같은 폴더에 다른 시험 파일도 있으니 이 스크립트가 만드는 것만 지운다.
fs.rmSync(lib, { recursive: true, force: true })
fs.mkdirSync(lib, { recursive: true })

const ff = (...args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffmpeg 실패: ${args.join(' ')}\n${r.stderr}`)
}

const cover = (name, color, w, h) => {
  const file = path.join(out, name)
  ff('-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}`, '-frames:v', '1', file)
  return file
}

const covers = {
  glass: cover('glass.jpg', '0x3a6b5a', 600, 600),
  afternoon: cover('afternoon.jpg', '0x6b5a3a', 800, 800),
  wide: cover('wide.jpg', '0x3a4a6b', 1000, 500),
  tiny: cover('tiny.jpg', '0x6b3a5a', 200, 200),
}

const write = (rel, { codec, seconds = 2, rate = 44100, art, tags = {}, extra = [] }) => {
  const file = path.join(lib, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const args = ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}:sample_rate=${rate}`]
  if (art) args.push('-i', art)
  args.push('-map', '0:a')
  if (art) args.push('-map', '1:v', '-c:v', 'copy', '-disposition:v:0', 'attached_pic')
  args.push(...codec, ...extra)
  for (const [k, v] of Object.entries(tags)) args.push('-metadata', `${k}=${v}`)
  if (!Object.keys(tags).length) args.push('-map_metadata', '-1')
  args.push(file)
  ff(...args)
}

const FLAC24 = ['-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24']
const MP3 = ['-c:a', 'libmp3lame', '-b:a', '320k', '-id3v2_version', '3']
const MP3LOW = ['-c:a', 'libmp3lame', '-b:a', '128k', '-id3v2_version', '3']
const AAC = ['-c:a', 'aac', '-b:a', '192k']
const OPUS = ['-c:a', 'libopus', '-b:a', '128k']
const VORBIS = ['-c:a', 'libvorbis', '-q:a', '4']

const glass = { artist: '밤의 정류장', album_artist: '밤의 정류장', album: '유리 온실', date: '2023', genre: '인디' }
write('밤의 정류장/유리 온실/1-02 새벽 버스.flac', { codec: FLAC24, rate: 96000, art: covers.glass, tags: { ...glass, title: '새벽 버스', track: '2/2', disc: '1/2' } })
write('밤의 정류장/유리 온실/1-01 창문을 열면.flac', { codec: FLAC24, rate: 96000, art: covers.glass, tags: { ...glass, title: '창문을 열면', track: '1/2', disc: '1/2' } })
write('밤의 정류장/유리 온실/2-01 돌아오는 길.flac', { codec: FLAC24, rate: 96000, art: covers.glass, tags: { ...glass, title: '돌아오는 길', track: '1/1', disc: '2/2' } })

const first = { artist: '밤의 정류장', album_artist: '밤의 정류장', album: '첫차', date: '2019', genre: '인디' }
write('밤의 정류장/첫차/01 출발.mp3', { codec: MP3, art: covers.wide, tags: { ...first, title: '출발', track: '1' } })

const afternoon = { artist: '낮은 구름', album_artist: '낮은 구름', album: '오후 세 시', date: '2021', genre: 'Jazz; Rock' }
write('낮은 구름/오후 세 시/01 비 오는 금요일.mp3', { codec: MP3, art: covers.afternoon, tags: { ...afternoon, title: '비 오는 금요일', track: '1' } })
write('낮은 구름/오후 세 시/02 저녁.mp3', { codec: MP3, art: covers.afternoon, tags: { ...afternoon, title: '저녁', track: '2' } })

const tide = { artist: 'Paper Harbor', album_artist: 'Paper Harbor', album: 'Low Tide', date: '2020', genre: 'Ambient' }
write('Paper Harbor/Low Tide/01 Shore.m4a', { codec: AAC, art: covers.tiny, tags: { ...tide, title: 'Shore', track: '1' } })

const slow = { artist: 'Field Notes', album: 'Slow Weather', date: '2018', genre: 'Ambient' }
write('Field Notes/Slow Weather/01 Rain.opus', { codec: OPUS, rate: 48000, tags: { ...slow, title: 'Rain', track: '1' } })
fs.copyFileSync(covers.afternoon, path.join(lib, 'Field Notes/Slow Weather/cover.jpg'))
write('Field Notes/Vorbis 앨범/01 Mist.ogg', { codec: VORBIS, tags: { artist: 'Field Notes', album: 'Vorbis 앨범', title: 'Mist', track: '1' } })

write('기타/여름 모음/01 첫 곡.mp3', { codec: MP3LOW, tags: { artist: '소금창고', album: '여름 모음', title: '첫 곡', track: '1' } })
write('기타/여름 모음/02 둘째 곡.mp3', { codec: MP3LOW, tags: { artist: '이른 눈', album: '여름 모음', title: '둘째 곡', track: '2' } })

write('기타/두장/CD1/곡 하나.opus', { codec: OPUS, rate: 48000, tags: { artist: '서쪽 창', album: '두 장짜리', title: '곡 하나', disc: '1', track: '1' } })
write('기타/두장/CD2/곡 둘.opus', { codec: OPUS, rate: 48000, tags: { artist: '서쪽 창', album: '두 장짜리', title: '곡 둘', disc: '2', track: '1' } })
fs.copyFileSync(covers.wide, path.join(lib, '기타/두장/cover.jpg'))

write('기타/무제/태그 없는 곡.mp3', { codec: MP3LOW })
fs.writeFileSync(path.join(lib, '기타/무제/깨짐.flac'), Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 37) % 251)))

// 태그가 바뀐 판: 같은 파일에 덮어써서 다시 읽는지 본다
const changed = path.join(out, 'changed.mp3')
const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-i', covers.afternoon, '-map', '0:a', '-map', '1:v', '-c:v', 'copy', '-disposition:v:0', 'attached_pic', ...MP3, '-metadata', 'title=제목이 바뀐 곡', '-metadata', 'artist=낮은 구름', '-metadata', 'album_artist=낮은 구름', '-metadata', 'album=오후 세 시', '-metadata', 'date=2021', '-metadata', 'genre=Jazz; Rock', '-metadata', 'track=2', changed], { encoding: 'utf8' })
if (r.status !== 0) throw new Error(r.stderr)

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
const files = walk(lib).map((f) => path.relative(lib, f).replaceAll('\\', '/')).sort()
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(files, null, 1))
console.log(`${files.length}개 파일, ${(walk(lib).reduce((n, f) => n + fs.statSync(f).size, 0) / 1024).toFixed(0)}KB`)
for (const f of files) console.log(' ', f)
