import { create } from 'zustand'
import { loadArtUrl } from '@/hooks/use-art-url'
import { isErrorNamed } from '@/lib/folders/access'
import type { TrackFile } from '@/lib/folders/types'
import { isPlayable } from '@/lib/metadata/format'
import { audio, clearSource, hasSource, setSource } from '@/lib/player/audio'
import { prepareSoundForPlayback } from '@/lib/player/sound-graph'
import {
  loadPosition,
  loadQueue,
  loadSettings,
  savePosition,
  saveQueue,
  saveSettings,
  type RepeatMode,
  type SavedPosition,
  type SavedQueue,
} from '@/lib/player/session'
import { trackSubtitle, trackTitle } from '@/lib/tracks'
import { notify, rescanFolder, useLibrary } from '@/stores/library-store'
import { readTrackFirst, useMetadata } from '@/stores/metadata-store'

const RESTART_THRESHOLD_SECONDS = 3
const SEEK_STEP_SECONDS = 5
const POSITION_SAVE_INTERVAL_MS = 5000
const MAX_CONSECUTIVE_FAILURES = 5

interface PlayerState {
  queue: TrackFile[]
  index: number
  isPlaying: boolean
  position: number
  duration: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
}

export const usePlayer = create<PlayerState>(() => ({
  queue: [],
  index: -1,
  isPlaying: false,
  position: 0,
  duration: 0,
  ...loadSettings(),
}))

const { getState: get, setState: set } = usePlayer

/** 셔플을 끄면 돌아갈 원래 순서. */
let sourceQueue: TrackFile[] = []
/** 곡을 빠르게 바꿀 때 늦게 끝난 이전 로드를 무시하기 위한 번호. */
let loadToken = 0
let pendingSeek = 0
let wantsPlayback = false
let failures = 0
let lastPositionSave = 0
let pendingRestore: { queue: SavedQueue; position: SavedPosition } | null = null

function getCurrentTrack() {
  const { queue, index } = get()
  return queue[index]
}

function shuffled<T>(items: T[]) {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function withCurrentFirst(tracks: TrackFile[], current: TrackFile) {
  return [current, ...shuffled(tracks.filter((track) => track !== current))]
}

function getNextIndex() {
  const { index, queue, repeat } = get()
  if (index + 1 < queue.length) return index + 1
  return repeat === 'all' ? 0 : -1
}

function persistQueue() {
  const { queue, shuffle } = get()
  saveQueue({
    ids: queue.map((track) => track.id),
    sourceIds: shuffle ? sourceQueue.map((track) => track.id) : undefined,
  })
}

function persistPosition() {
  const track = getCurrentTrack()
  // audio.currentTime은 곡이 바뀌는 순간 이전 곡의 시간이므로 스토어 값을 쓴다.
  if (track) savePosition({ trackId: track.id, position: get().position })
}

function stopPlayback() {
  loadToken += 1
  wantsPlayback = false
  clearSource()
  set({ isPlaying: false, position: 0, duration: 0 })
}

function failTrack(message: string) {
  notify(message)
  if (!wantsPlayback) {
    stopPlayback()
    return
  }

  failures += 1
  const nextIndex = getNextIndex()
  const limit = Math.min(get().queue.length, MAX_CONSECUTIVE_FAILURES)

  if (failures >= limit || nextIndex < 0) {
    if (failures >= limit) notify(`곡 ${failures}개를 연속으로 재생하지 못해 멈췄습니다.`)
    failures = 0
    stopPlayback()
    return
  }

  void loadTrack(nextIndex, { autoplay: true })
}

async function loadTrack(index: number, options: { autoplay: boolean; startAt?: number }) {
  const track = get().queue[index]
  if (!track) return

  const { autoplay, startAt = 0 } = options
  loadToken += 1
  const token = loadToken
  wantsPlayback = autoplay
  set({ index, position: startAt, duration: 0, isPlaying: autoplay })
  readTrackFirst(track)

  let file: File
  try {
    file = track.source instanceof File ? track.source : await track.source.getFile()
  } catch (error) {
    if (token !== loadToken) return

    if (isErrorNamed(error, 'NotAllowedError')) {
      stopPlayback()
      notify('폴더를 다시 연결하면 재생할 수 있습니다.')
      void rescanFolder(track.folderId)
    } else {
      failTrack(`파일을 찾을 수 없습니다: ${track.name}`)
    }
    return
  }

  if (token !== loadToken) return

  pendingSeek = startAt
  setSource(file)
  if (autoplay) startAudio()
}

function startAudio() {
  prepareSoundForPlayback()
  audio.play().catch((error: unknown) => {
    // 재생할 수 없는 파일은 error 이벤트에서 처리한다.
    if (isErrorNamed(error, 'NotAllowedError')) set({ isPlaying: false })
  })
}

export function playList(tracks: TrackFile[], startIndex = 0) {
  const current = tracks[startIndex]
  if (!current) return

  pendingRestore = null
  failures = 0
  sourceQueue = tracks

  const { shuffle } = get()
  set({ queue: shuffle ? withCurrentFirst(tracks, current) : tracks })
  void loadTrack(shuffle ? 0 : startIndex, { autoplay: true })
}

export function shufflePlay(tracks: TrackFile[]) {
  set({ shuffle: true })
  playList(tracks, Math.floor(Math.random() * tracks.length))
}

export function togglePlay() {
  if (!getCurrentTrack()) return

  if (!audio.paused) {
    wantsPlayback = false
    audio.pause()
    return
  }

  failures = 0
  if (!hasSource()) {
    void loadTrack(get().index, { autoplay: true })
    return
  }

  wantsPlayback = true
  startAudio()
}

export function seek(seconds: number) {
  audio.currentTime = seconds
  set({ position: seconds })
  persistPosition()
}

export function seekBy(delta: number) {
  if (!hasSource()) return
  seek(Math.min(Math.max(audio.currentTime + delta, 0), get().duration))
}

export function seekStep(direction: 1 | -1) {
  seekBy(direction * SEEK_STEP_SECONDS)
}

export function playNext() {
  const nextIndex = getNextIndex()
  if (nextIndex < 0) return

  failures = 0
  void loadTrack(nextIndex, { autoplay: true })
}

export function playPrevious() {
  const { index, queue, repeat } = get()
  if (index < 0) return

  failures = 0
  if (audio.currentTime > RESTART_THRESHOLD_SECONDS) {
    seek(0)
  } else if (index > 0) {
    void loadTrack(index - 1, { autoplay: true })
  } else if (repeat === 'all') {
    void loadTrack(queue.length - 1, { autoplay: true })
  } else {
    seek(0)
  }
}

export function jumpTo(index: number) {
  failures = 0
  void loadTrack(index, { autoplay: true })
}

export function toggleShuffle() {
  const { shuffle, queue } = get()
  const current = getCurrentTrack()

  if (!current) {
    set({ shuffle: !shuffle })
    return
  }

  if (shuffle) {
    set({ shuffle: false, queue: sourceQueue, index: sourceQueue.indexOf(current) })
  } else {
    sourceQueue = queue
    set({ shuffle: true, queue: withCurrentFirst(queue, current), index: 0 })
  }
}

export function cycleRepeat() {
  const order: RepeatMode[] = ['off', 'all', 'one']
  const { repeat } = get()
  set({ repeat: order[(order.indexOf(repeat) + 1) % order.length] })
}

export function setVolume(volume: number) {
  set({ volume, muted: false })
}

export function toggleMute() {
  set({ muted: !get().muted })
}

function describeTracks(tracks: TrackFile[]) {
  if (tracks.length > 1) return `${tracks.length.toLocaleString('ko-KR')}곡`
  return trackTitle(tracks[0], useMetadata.getState().items[tracks[0].id])
}

export function addToQueue(tracks: TrackFile[]) {
  const { queue } = get()
  if (queue.length === 0) {
    playList(tracks)
    return
  }

  sourceQueue = [...sourceQueue, ...tracks]
  set({ queue: [...queue, ...tracks] })
  notify(`대기열에 추가했습니다: ${describeTracks(tracks)}`)
}

export function playNextInQueue(tracks: TrackFile[]) {
  const { queue, index } = get()
  if (queue.length === 0) {
    playList(tracks)
    return
  }

  sourceQueue = [...sourceQueue, ...tracks]
  set({ queue: queue.toSpliced(index + 1, 0, ...tracks) })
  notify(`다음에 재생합니다: ${describeTracks(tracks)}`)
}

function withoutTrack(list: TrackFile[], track: TrackFile) {
  const position = list.indexOf(track)
  return position < 0 ? list : list.toSpliced(position, 1)
}

export function removeFromQueue(index: number) {
  const { queue } = get()
  const track = queue[index]
  if (!track) return

  sourceQueue = withoutTrack(sourceQueue, track)
  set({ queue: queue.toSpliced(index, 1) })
}

export function clearUpcoming() {
  const { queue, index } = get()
  const upcoming = new Set(queue.slice(index + 1))

  sourceQueue = sourceQueue.filter((track) => !upcoming.has(track))
  set({ queue: queue.slice(0, index + 1) })
}

/** 폴더가 제거되면 그 폴더의 곡을 대기열에서 뺀다. */
function removeFolderTracks(isRemoved: (track: TrackFile) => boolean) {
  const { queue, index, isPlaying } = get()
  const remaining = queue.filter((track) => !isRemoved(track))
  if (remaining.length === queue.length) return

  sourceQueue = sourceQueue.filter((track) => !isRemoved(track))
  const current = queue[index]

  if (current && !isRemoved(current)) {
    set({ queue: remaining, index: remaining.indexOf(current) })
    return
  }

  stopPlayback()
  const nextIndex = queue.slice(0, index).filter((track) => !isRemoved(track)).length
  set({ queue: remaining, index: remaining.length > 0 ? Math.min(nextIndex, remaining.length - 1) : -1 })
  if (remaining.length > 0) void loadTrack(get().index, { autoplay: isPlaying })
}

function tryRestore() {
  if (!pendingRestore) return

  const { folders, tracks } = useLibrary.getState()
  if (folders.some((folder) => folder.status === 'scanning')) return

  // 재생할 수 없는 코덱으로 밝혀진 곡은 되살리지 않는다.
  const { items } = useMetadata.getState()
  const byId = new Map(
    Object.values(tracks)
      .flat()
      .filter((track) => !items[track.id] || isPlayable(items[track.id]))
      .map((track) => [track.id, track]),
  )
  const { queue: saved, position } = pendingRestore
  const current = byId.get(position.trackId)
  if (!current) return

  const resolve = (ids: string[]) => ids.flatMap((id) => byId.get(id) ?? [])
  const queue = resolve(saved.ids)
  pendingRestore = null
  sourceQueue = saved.sourceIds ? resolve(saved.sourceIds) : queue

  set({ queue })
  void loadTrack(queue.indexOf(current), { autoplay: false, startAt: position.position })
}

function updateMediaPosition() {
  const { duration, position } = get()
  if (!('mediaSession' in navigator) || !duration) return

  navigator.mediaSession.setPositionState({
    duration,
    playbackRate: audio.playbackRate,
    position: Math.min(position, duration),
  })
}

function updateTrackInfo(track: TrackFile | undefined) {
  const meta = track && useMetadata.getState().items[track.id]
  document.title = track ? `${trackTitle(track, meta)} - Music Player` : 'Music Player'
  if (!('mediaSession' in navigator)) return

  if (!track) {
    navigator.mediaSession.metadata = null
    return
  }

  const metadata = new MediaMetadata({
    title: trackTitle(track, meta),
    artist: trackSubtitle(track, meta),
    album: meta?.album,
  })
  navigator.mediaSession.metadata = metadata

  if (!meta?.artId) return
  void loadArtUrl(meta.artId).then((src) => {
    // 그사이 곡이 바뀌었으면 이전 곡의 표지를 붙이지 않는다.
    if (src && navigator.mediaSession.metadata === metadata) {
      metadata.artwork = [{ src, type: 'image/jpeg' }]
    }
  })
}

function bindAudioEvents() {
  audio.addEventListener('timeupdate', () => {
    set({ position: audio.currentTime })
    if (Date.now() - lastPositionSave > POSITION_SAVE_INTERVAL_MS) {
      lastPositionSave = Date.now()
      persistPosition()
    }
  })
  audio.addEventListener('durationchange', () => {
    set({ duration: Number.isFinite(audio.duration) ? audio.duration : 0 })
    updateMediaPosition()
  })
  audio.addEventListener('loadedmetadata', () => {
    if (pendingSeek > 0) audio.currentTime = pendingSeek
    pendingSeek = 0
  })
  audio.addEventListener('play', () => set({ isPlaying: true }))
  audio.addEventListener('playing', () => {
    failures = 0
  })
  audio.addEventListener('pause', () => {
    set({ isPlaying: false })
    persistPosition()
  })
  audio.addEventListener('ended', () => {
    if (get().repeat === 'one') {
      audio.currentTime = 0
      startAudio()
      return
    }

    const nextIndex = getNextIndex()
    if (nextIndex >= 0) {
      void loadTrack(nextIndex, { autoplay: true })
    } else {
      audio.currentTime = 0
      set({ isPlaying: false, position: 0 })
      persistPosition()
    }
  })
  audio.addEventListener('error', () => {
    const track = getCurrentTrack()
    if (track && hasSource()) failTrack(`재생할 수 없는 파일입니다: ${track.name}`)
  })
}

function bindMediaSession() {
  if (!('mediaSession' in navigator)) return

  const { mediaSession } = navigator
  mediaSession.setActionHandler('play', togglePlay)
  mediaSession.setActionHandler('pause', togglePlay)
  mediaSession.setActionHandler('previoustrack', playPrevious)
  mediaSession.setActionHandler('nexttrack', playNext)
  mediaSession.setActionHandler('seekbackward', () => seekStep(-1))
  mediaSession.setActionHandler('seekforward', () => seekStep(1))
  mediaSession.setActionHandler('seekto', ({ seekTime }) => {
    if (seekTime !== undefined) seek(seekTime)
  })
}

export function initPlayer() {
  const { volume, muted } = get()
  audio.volume = volume
  audio.muted = muted

  const queue = loadQueue()
  const position = loadPosition()
  if (queue && position) pendingRestore = { queue, position }

  bindAudioEvents()
  bindMediaSession()

  usePlayer.subscribe((state, previous) => {
    if (state.volume !== previous.volume) audio.volume = state.volume
    if (state.muted !== previous.muted) audio.muted = state.muted

    if (
      state.volume !== previous.volume ||
      state.muted !== previous.muted ||
      state.shuffle !== previous.shuffle ||
      state.repeat !== previous.repeat
    ) {
      const { volume: nextVolume, muted: nextMuted, shuffle, repeat } = state
      saveSettings({ volume: nextVolume, muted: nextMuted, shuffle, repeat })
    }

    if (state.queue !== previous.queue) persistQueue()

    const track = state.queue[state.index]
    if (track !== previous.queue[previous.index]) {
      updateTrackInfo(track)
      persistPosition()
    }

    if (state.isPlaying !== previous.isPlaying && 'mediaSession' in navigator) {
      navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused'
    }
  })

  useLibrary.subscribe((state, previous) => {
    if (state.folders !== previous.folders) {
      const ids = new Set(state.folders.map((folder) => folder.id))
      removeFolderTracks((track) => !ids.has(track.folderId))
    }
    tryRestore()
  })

  // 재생을 시작한 뒤에 태그가 도착하면 제목과 잠금 화면 정보를 고친다.
  useMetadata.subscribe((state, previous) => {
    const track = getCurrentTrack()
    if (track && state.items[track.id] !== previous.items[track.id]) updateTrackInfo(track)
  })

  window.addEventListener('pagehide', persistPosition)
}
