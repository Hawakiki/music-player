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

export function formatTotalTime(seconds: number) {
  if (seconds < 60) return '1분 미만'

  const minutes = Math.round(seconds / 60)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}시간 ${minutes % 60}분` : `${minutes}분`
}
