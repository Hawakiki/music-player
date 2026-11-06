import { create } from 'zustand'
import type { TrackMeta } from '@/lib/metadata/types'
import { isProcessing, updateSound, type CrossfeedLevel, type SoundSettings } from '@/lib/player/sound-graph'
import { useEq } from '@/stores/eq-store'
import { notify } from '@/stores/library-store'
import { useMetadata } from '@/stores/metadata-store'
import { usePlayer } from '@/stores/player-store'

const STORAGE_KEY = 'music-player:sound'

export type LoudnessMode = 'off' | 'track' | 'album'

interface SoundState {
  bass: number
  treble: number
  balance: number
  width: number
  mono: boolean
  crossfeed: CrossfeedLevel
  limiter: boolean
  loudness: LoudnessMode
  /** 원음 듣기. 잠깐 비교하려고 쓰는 값이라 저장하지 않는다. */
  direct: boolean
}

const DEFAULTS: SoundState = {
  bass: 0,
  treble: 0,
  balance: 0,
  width: 1,
  mono: false,
  crossfeed: 'off',
  limiter: true,
  loudness: 'off',
  direct: false,
}

function inRange(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === 'number' && value >= min && value <= max ? value : fallback
}

function load(): SoundState {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (typeof stored !== 'object' || stored === null) return DEFAULTS

    const { bass, treble, balance, width, mono, crossfeed, limiter, loudness } = stored as Record<string, unknown>
    return {
      bass: inRange(bass, -12, 12, 0),
      treble: inRange(treble, -12, 12, 0),
      balance: inRange(balance, -1, 1, 0),
      width: inRange(width, 0, 2, 1),
      mono: mono === true,
      crossfeed: crossfeed === 'light' || crossfeed === 'medium' || crossfeed === 'strong' ? crossfeed : 'off',
      limiter: limiter !== false,
      loudness: loudness === 'track' || loudness === 'album' ? loudness : 'off',
      direct: false,
    }
  } catch {
    return DEFAULTS
  }
}

export const useSound = create<SoundState>(load)

export function setSound(patch: Partial<SoundState>) {
  useSound.setState(patch)
}

/** 소리 조절만 되돌린다. 설정 화면의 값은 그대로 둔다. */
export function resetSound() {
  const { bass, treble, balance, width, mono, crossfeed } = DEFAULTS
  useSound.setState({ bass, treble, balance, width, mono, crossfeed })
}

function getTrackGainDb(meta: TrackMeta | undefined, mode: LoudnessMode) {
  if (!meta || mode === 'off') return 0

  const gain = mode === 'album' ? (meta.albumGain ?? meta.trackGain) : meta.trackGain
  const peak = mode === 'album' ? (meta.albumPeak ?? meta.trackPeak) : meta.trackPeak
  if (gain === undefined) return 0

  // 올려도 원본 피크가 잘리지 않는 만큼만 올린다.
  return peak ? Math.min(gain, -20 * Math.log10(peak)) : gain
}

function getSettings(): SoundSettings {
  const { enabled, preamp, gains } = useEq.getState()
  const { bass, treble, balance, width, mono, crossfeed, limiter, loudness, direct } = useSound.getState()
  const { queue, index } = usePlayer.getState()
  const track = queue[index]
  const meta = track && useMetadata.getState().items[track.id]

  return {
    eqEnabled: enabled,
    preamp,
    gains,
    bass,
    treble,
    balance,
    width,
    mono,
    crossfeed,
    limiter,
    trackGainDb: getTrackGainDb(meta, loudness),
    direct,
  }
}

function sync() {
  try {
    updateSound(getSettings())
  } catch {
    useEq.setState({ enabled: false })
    notify('이 브라우저에서는 음향 효과를 켤 수 없습니다.')
  }
}

export function useSoundProcessing() {
  useEq((state) => state.enabled)
  useSound()
  return isProcessing({ ...getSettings(), trackGainDb: 0 })
}

export function initSound() {
  sync()

  useEq.subscribe(sync)
  useSound.subscribe((state) => {
    sync()
    try {
      const { direct: _direct, ...saved } = state
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    } catch {
      // 저장하지 못해도 지금 소리에는 적용한다.
    }
  })
  usePlayer.subscribe((state, previous) => {
    if (state.queue[state.index] !== previous.queue[previous.index]) sync()
  })
  useMetadata.subscribe((state, previous) => {
    const { queue, index } = usePlayer.getState()
    const track = queue[index]
    if (track && state.items[track.id] !== previous.items[track.id]) sync()
  })
}
