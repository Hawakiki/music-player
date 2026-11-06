import { create } from 'zustand'
import type { TrackMeta } from '@/lib/metadata/types'
import {
  isProcessing,
  onRestoreStatus,
  updateSound,
  type CrossfeedLevel,
  type PhaseLevel,
  type SoundSettings,
  type VinylLevel,
} from '@/lib/player/sound-graph'
import type { RestoreLevel, RestoreStatus } from '@/lib/player/restore-stage'
import type { TubeMode } from '@/lib/player/tube-stage'
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
  tube: number
  tubeMode: TubeMode
  vinyl: VinylLevel
  phase: PhaseLevel
  restore: RestoreLevel
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
  tube: 0,
  tubeMode: 'triode',
  vinyl: 'off',
  phase: 'off',
  restore: 'off',
  limiter: true,
  loudness: 'off',
  direct: false,
}

function inRange(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === 'number' && value >= min && value <= max ? value : fallback
}

function toLevel(value: unknown) {
  return value === 'light' || value === 'medium' || value === 'strong' ? value : 'off'
}

function load(): SoundState {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (typeof stored !== 'object' || stored === null) return DEFAULTS

    const { bass, treble, balance, width, mono, crossfeed, tube, tubeMode, vinyl, phase, restore, limiter, loudness } =
      stored as Record<string, unknown>
    return {
      bass: inRange(bass, -12, 12, 0),
      treble: inRange(treble, -12, 12, 0),
      balance: inRange(balance, -1, 1, 0),
      width: inRange(width, 0, 2, 1),
      mono: mono === true,
      crossfeed: toLevel(crossfeed),
      tube: inRange(tube, 0, 1, 0),
      tubeMode: tubeMode === 'ultralinear' ? 'ultralinear' : 'triode',
      vinyl: toLevel(vinyl),
      phase: toLevel(phase),
      restore: toLevel(restore),
      limiter: limiter !== false,
      loudness: loudness === 'track' || loudness === 'album' ? loudness : 'off',
      direct: false,
    }
  } catch {
    return DEFAULTS
  }
}

export const useSound = create<SoundState>(load)

/** 재생 중에 계속 바뀌는 값이라 저장하는 설정과 나눠 둔다. */
export const useRestoreStatus = create<{ status: RestoreStatus }>(() => ({ status: 'analyzing' }))

export function setSound(patch: Partial<SoundState>) {
  useSound.setState(patch)
}

/** 소리 조절만 되돌린다. 설정 화면의 값은 그대로 둔다. */
export function resetSound() {
  const { bass, treble, balance, width, mono, crossfeed, tube, tubeMode, vinyl, phase, restore } = DEFAULTS
  useSound.setState({ bass, treble, balance, width, mono, crossfeed, tube, tubeMode, vinyl, phase, restore })
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
  const { bass, treble, balance, width, mono, crossfeed, tube, tubeMode, vinyl, phase, restore, limiter, loudness, direct } =
    useSound.getState()
  const { queue, index, isPlaying, volume, muted } = usePlayer.getState()
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
    tube,
    tubeMode,
    vinyl,
    phase,
    restore,
    limiter,
    trackGainDb: getTrackGainDb(meta, loudness),
    playing: isPlaying,
    volume: muted ? 0 : volume,
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
  onRestoreStatus((status) => useRestoreStatus.setState({ status }))
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
    if (
      state.queue[state.index] !== previous.queue[previous.index] ||
      state.isPlaying !== previous.isPlaying ||
      state.volume !== previous.volume ||
      state.muted !== previous.muted
    ) {
      sync()
    }
  })
  useMetadata.subscribe((state, previous) => {
    const { queue, index } = usePlayer.getState()
    const track = queue[index]
    if (track && state.items[track.id] !== previous.items[track.id]) sync()
  })
}
