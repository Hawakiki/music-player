import { create } from 'zustand'
import { EQ_BANDS, EQ_RANGE, type EqValues } from '@/lib/player/sound-graph'
import { notify } from '@/stores/library-store'

const STORAGE_KEY = 'music-player:eq'

export interface EqPreset extends EqValues {
  id: string
  name: string
}

export const BUILT_IN_PRESETS: EqPreset[] = [
  { id: 'flat', name: '평탄', preamp: 0, gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'bass', name: '저음 강조', preamp: -4, gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: 'treble', name: '고음 강조', preamp: -4, gains: [0, 0, 0, 0, 0, 0, 2, 3, 5, 6] },
  { id: 'vocal', name: '보컬 또렷하게', preamp: -2, gains: [-2, -1, 0, 1, 2, 3, 3, 2, 1, 0] },
  { id: 'wide', name: '저음과 고음 강조', preamp: -4, gains: [5, 4, 2, 0, -1, -1, 0, 2, 4, 5] },
]

interface EqState extends EqValues {
  enabled: boolean
  /** 지금 값이 어떤 프리셋과 같은지. 손으로 바꾸면 null이다. */
  presetId: string | null
  customPresets: EqPreset[]
}

function clampGain(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, -EQ_RANGE), EQ_RANGE) : 0
}

function toValues(value: Record<string, unknown>): EqValues {
  const gains = Array.isArray(value.gains) ? value.gains : []
  return { preamp: clampGain(value.preamp), gains: EQ_BANDS.map((_, index) => clampGain(gains[index])) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toPreset(value: unknown): EqPreset[] {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return []
  return [{ id: value.id, name: value.name, ...toValues(value) }]
}

function load(): EqState {
  const defaults: EqState = { enabled: false, presetId: 'flat', customPresets: [], ...BUILT_IN_PRESETS[0] }

  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!isRecord(stored)) return defaults

    return {
      enabled: stored.enabled === true,
      presetId: typeof stored.presetId === 'string' ? stored.presetId : null,
      customPresets: Array.isArray(stored.customPresets) ? stored.customPresets.flatMap(toPreset) : [],
      ...toValues(stored),
    }
  } catch {
    return defaults
  }
}

export const useEq = create<EqState>(load)

const { getState: get, setState: set } = useEq

function findPreset(id: string) {
  return [...BUILT_IN_PRESETS, ...get().customPresets].find((preset) => preset.id === id)
}

export function setEqEnabled(enabled: boolean) {
  set({ enabled })
}

export function setPreamp(preamp: number) {
  set({ preamp, presetId: null })
}

export function setBandGain(index: number, gain: number) {
  set((state) => ({ gains: state.gains.with(index, gain), presetId: null }))
}

export function selectPreset(id: string) {
  const preset = findPreset(id)
  if (preset) set({ preamp: preset.preamp, gains: preset.gains, presetId: id })
}

export function resetEq() {
  selectPreset('flat')
}

export function savePreset(name: string) {
  const { preamp, gains } = get()
  const preset: EqPreset = { id: crypto.randomUUID(), name, preamp, gains }
  set((state) => ({ customPresets: [...state.customPresets, preset], presetId: preset.id }))
  notify(`프리셋을 저장했습니다: ${name}`)
}

export function deletePreset(id: string) {
  set((state) => ({
    customPresets: state.customPresets.filter((preset) => preset.id !== id),
    presetId: state.presetId === id ? null : state.presetId,
  }))
}

export function initEq() {
  useEq.subscribe(({ enabled, preamp, gains, presetId, customPresets }) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled, preamp, gains, presetId, customPresets }))
    } catch {
      // 저장하지 못해도 지금 소리에는 적용한다.
    }
  })
}
