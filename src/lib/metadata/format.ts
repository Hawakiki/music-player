import { getExtension } from '@/lib/tracks'
import type { TrackMeta } from './types'

const CODEC_NAMES: [RegExp, string][] = [
  [/layer 3|mp3/i, 'MP3'],
  [/flac/i, 'FLAC'],
  [/alac/i, 'ALAC'],
  [/aac/i, 'AAC'],
  [/vorbis/i, 'Vorbis'],
  [/opus/i, 'Opus'],
  [/pcm/i, 'WAV'],
]

function shortCodec(codec: string) {
  return CODEC_NAMES.find(([pattern]) => pattern.test(codec))?.[1] ?? codec
}

/** `FLAC 96 kHz / 24 bit`, `MP3 320 kbps` 형태로 만든다. */
export function formatLabel({ codec, lossless, sampleRate, bitsPerSample, bitrate }: TrackMeta) {
  if (!codec) return undefined

  const name = shortCodec(codec)
  if (lossless && sampleRate && bitsPerSample) {
    return `${name} ${sampleRate / 1000} kHz / ${bitsPerSample} bit`
  }
  return bitrate ? `${name} ${Math.round(bitrate / 1000)} kbps` : name
}

const COMMON_SAMPLE_RATES = new Set([44100, 48000, 88200, 96000, 176400, 192000])
const COMMON_BIT_DEPTHS = new Set([16, 24])
/** 앱이 받는 확장자 중 흔치 않은 것. 날것의 AAC 스트림, Ogg·WebM·Matroska 오디오, 오디오북이다. */
const UNUSUAL_EXTENSIONS = new Set(['aac', 'm4b', 'mka', 'oga', 'weba'])

/** Chrome과 Edge 모두에서 재생에 실패한 코덱. 확장자는 받는 것이라도 안에 든 코덱이 이러면 재생할 수 없다. */
const UNPLAYABLE_CODECS = [/^alac$/i, /adpcm/i, /gsm/i, /speex/i, /^dts/i, /mpeg\/l2|layer 2/i, /truehd|mlp/i]
/**
 * 브라우저마다 다른 코덱. Edge는 Windows 코덱으로 재생하고 Chrome은 못 한다. 지금 브라우저에 직접 묻는다.
 * 두 브라우저 모두 `canPlayType`의 답이 실제 재생 결과와 같았다.
 */
const BROWSER_CODECS: [RegExp, string][] = [
  [/^ac-?3$/i, 'audio/mp4; codecs="ac-3"'],
  [/^(e-?ac-?3|ec-?3)$/i, 'audio/mp4; codecs="ec-3"'],
]
const browserAnswers = new Map<string, boolean>()
/** float WAV는 32bit까지만 재생된다. */
const MAX_FLOAT_BITS = 32

/**
 * 재생은 되지만 흔치 않은 파일. 드문 확장자, 표준 밖의 샘플레이트, 다채널, 16·24bit가 아닌 PCM이다.
 * 모노는 옛 녹음에 흔해서 넣지 않는다.
 * 비트 수는 무손실 여부를 보지 않는다. 32bit float WAV는 무손실이 아니라고 읽힌다. 손실 압축은 비트 수가 없다.
 */
export function isUnusualFormat({ sampleRate, channels, bitsPerSample }: TrackMeta, fileName: string) {
  if (UNUSUAL_EXTENSIONS.has(getExtension(fileName))) return true
  if (sampleRate && !COMMON_SAMPLE_RATES.has(sampleRate)) return true
  if (channels && channels > 2) return true
  return Boolean(bitsPerSample && !COMMON_BIT_DEPTHS.has(bitsPerSample))
}

function canBrowserPlay(type: string) {
  // 워커처럼 문서가 없는 곳에서는 물을 수 없으니 된다고 본다.
  if (typeof document === 'undefined') return true

  let answer = browserAnswers.get(type)
  if (answer === undefined) {
    answer = document.createElement('audio').canPlayType(type) !== ''
    browserAnswers.set(type, answer)
  }
  return answer
}

/** 태그로 읽은 코덱을 브라우저가 재생할 수 있는지. 코덱을 모르면 재생해 보기 전에는 모르므로 된다고 본다. */
export function isPlayable({ codec, bitsPerSample }: TrackMeta) {
  if (!codec) return true
  if (UNPLAYABLE_CODECS.some((pattern) => pattern.test(codec))) return false
  const asked = BROWSER_CODECS.find(([pattern]) => pattern.test(codec))
  if (asked && !canBrowserPlay(asked[1])) return false
  return !(/ieee_float/i.test(codec) && (bitsPerSample ?? 0) > MAX_FLOAT_BITS)
}

export function formatTotalTime(seconds: number) {
  if (seconds < 60) return '1분 미만'

  const minutes = Math.round(seconds / 60)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}시간 ${minutes % 60}분` : `${minutes}분`
}
