export type RepeatMode = 'off' | 'all' | 'one'

export interface PlayerSettings {
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
}

export interface SavedQueue {
  ids: string[]
  /** 셔플 중일 때 원래 순서. */
  sourceIds?: string[]
}

export interface SavedPosition {
  trackId: string
  position: number
}

const SETTINGS_KEY = 'music-player:settings'
const QUEUE_KEY = 'music-player:queue'
const POSITION_KEY = 'music-player:position'

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 저장하지 못해도 재생에는 지장이 없다.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function loadSettings(): PlayerSettings {
  const stored = read(SETTINGS_KEY)
  const { volume, muted, shuffle, repeat } = isRecord(stored) ? stored : {}

  return {
    volume: typeof volume === 'number' && volume >= 0 && volume <= 1 ? volume : 1,
    muted: muted === true,
    shuffle: shuffle === true,
    repeat: repeat === 'all' || repeat === 'one' ? repeat : 'off',
  }
}

export function saveSettings(settings: PlayerSettings) {
  write(SETTINGS_KEY, settings)
}

export function loadQueue(): SavedQueue | null {
  const stored = read(QUEUE_KEY)
  if (!isRecord(stored) || !isStringArray(stored.ids)) return null

  return {
    ids: stored.ids,
    sourceIds: isStringArray(stored.sourceIds) ? stored.sourceIds : undefined,
  }
}

export function saveQueue(queue: SavedQueue) {
  write(QUEUE_KEY, queue)
}

export function loadPosition(): SavedPosition | null {
  const stored = read(POSITION_KEY)
  if (!isRecord(stored)) return null

  const { trackId, position } = stored
  if (typeof trackId !== 'string' || typeof position !== 'number' || position < 0) return null
  return { trackId, position }
}

export function savePosition(position: SavedPosition) {
  write(POSITION_KEY, position)
}
