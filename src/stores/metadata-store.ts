import { create } from 'zustand'
import { deleteFolderRecords, deleteTrackMeta, loadTrackMeta, pruneArt, saveTrackMeta } from '@/lib/db'
import type { TrackFile } from '@/lib/folders/types'
import type { ReadJob, ReadResult, TrackMeta, WorkerResult } from '@/lib/metadata/types'
import { notify, useLibrary } from '@/stores/library-store'

const CONCURRENCY = 4
const FLUSH_INTERVAL_MS = 250

interface MetadataState {
  items: Record<string, TrackMeta>
  /** 처음 읽는 곡의 진행 상황. 바뀌었는지만 확인하는 곡은 세지 않는다. */
  total: number
  done: number
}

export const useMetadata = create<MetadataState>(() => ({ items: {}, total: 0, done: 0 }))

const { getState: get, setState: set } = useMetadata

let worker: Worker | null = null
let workerFailed = false
let flushTimer: ReturnType<typeof setTimeout> | null = null

const pending = new Map<string, TrackFile>()
const urgent = new Map<string, TrackFile>()
const active = new Map<string, TrackFile>()
const counted = new Set<string>()
const coverRequests = new Map<string, (image: Blob | null) => void>()
let finished: TrackMeta[] = []
let finishedCount = 0
let cacheLoaded = false
let pruneRequested = false

function getWorker() {
  if (worker) return worker

  worker = new Worker(new URL('../workers/metadata.worker.ts', import.meta.url), { type: 'module' })
  worker.addEventListener('message', ({ data }: MessageEvent<WorkerResult>) => {
    if (data.kind === 'cover') {
      coverRequests.get(data.id)?.(data.image)
      coverRequests.delete(data.id)
    } else {
      onResult(data)
    }
  })
  worker.addEventListener('error', () => {
    workerFailed = true
    pending.clear()
    urgent.clear()
    active.clear()
    counted.clear()
    set({ total: 0, done: 0 })
    notify('곡 정보를 읽지 못했습니다.')
  })
  return worker
}

function isIdle() {
  return pending.size === 0 && urgent.size === 0 && active.size === 0
}

/** 읽는 중에는 방금 저장한 표지를 지울 수 있으므로 읽기가 끝난 뒤에 정리한다. */
function pruneArtWhenIdle() {
  if (!pruneRequested || !cacheLoaded || !isIdle() || finished.length > 0) return

  pruneRequested = false
  const used = new Set(Object.values(get().items).flatMap((item) => item.artId ?? []))
  void pruneArt(used).catch(() => {})
}

function takeNext() {
  for (const queue of [urgent, pending]) {
    const next = queue.values().next()
    if (!next.done) {
      queue.delete(next.value.id)
      return next.value
    }
  }
  return undefined
}

function pump() {
  while (!workerFailed && active.size < CONCURRENCY) {
    const track = takeNext()
    if (!track) return

    const known = get().items[track.id]
    const job: ReadJob = {
      kind: 'read',
      id: track.id,
      source: track.source,
      cover: track.cover,
      known: known && { size: known.size, lastModified: known.lastModified },
    }
    active.set(track.id, track)
    getWorker().postMessage(job)
  }
}

function flush() {
  flushTimer = null
  const batch = finished
  const doneCount = finishedCount
  finished = []
  finishedCount = 0

  const idle = isIdle()
  set((state) => ({
    items: batch.length > 0 ? { ...state.items, ...Object.fromEntries(batch.map((item) => [item.id, item])) } : state.items,
    total: idle ? 0 : state.total,
    done: idle ? 0 : state.done + doneCount,
  }))

  // 세션 폴더는 다음 방문에 없으므로 저장하지 않는다.
  const stored = new Set(
    useLibrary.getState().folders.flatMap((folder) => (folder.handle ? [folder.id] : [])),
  )
  const persistent = batch.filter((item) => stored.has(item.folderId))
  if (persistent.length > 0) void saveTrackMeta(persistent).catch(() => {})
  pruneArtWhenIdle()
}

function onResult(result: ReadResult) {
  const track = active.get(result.id)
  active.delete(result.id)

  if (counted.delete(result.id)) finishedCount += 1
  if (track && result.kind === 'read') {
    finished.push({
      ...result.tags,
      id: track.id,
      folderId: track.folderId,
      addedAt: get().items[track.id]?.addedAt ?? Date.now(),
    })
  }

  flushTimer ??= setTimeout(flush, FLUSH_INTERVAL_MS)
  pump()
}

function enqueue(tracks: TrackFile[]) {
  const { items } = get()
  let added = 0

  for (const track of tracks) {
    pending.set(track.id, track)
    if (!items[track.id] && !counted.has(track.id)) {
      counted.add(track.id)
      added += 1
    }
  }

  if (added > 0) set((state) => ({ total: state.total + added }))
  pump()
}

/** 전체 화면에 쓸 원본 표지를 읽는다. 없으면 null이다. */
export function requestCover({ id, source, cover }: TrackFile) {
  if (workerFailed) return Promise.resolve(null)

  return new Promise<Blob | null>((resolve) => {
    coverRequests.get(id)?.(null)
    coverRequests.set(id, resolve)
    getWorker().postMessage({ kind: 'cover', id, source, cover })
  })
}

/** 재생을 시작한 곡은 줄을 서지 않고 먼저 읽는다. */
export function readTrackFirst(track: TrackFile) {
  if (get().items[track.id] || active.has(track.id)) return

  pending.delete(track.id)
  urgent.set(track.id, track)
  pump()
}

/** 스캔 결과에 없는 곡, 즉 지워진 파일의 정보를 없앤다. */
function forgetMissingTracks(folderId: string, tracks: TrackFile[]) {
  const present = new Set(tracks.map((track) => track.id))
  const missing = Object.values(get().items)
    .filter((item) => item.folderId === folderId && !present.has(item.id))
    .map((item) => item.id)
  if (missing.length === 0) return

  set((state) => {
    const items = { ...state.items }
    for (const id of missing) delete items[id]
    return { items }
  })
  pruneRequested = true
  void deleteTrackMeta(missing)
    .catch(() => {})
    .finally(pruneArtWhenIdle)
}

function forgetFolder(folderId: string) {
  for (const queue of [pending, urgent]) {
    for (const track of queue.values()) {
      if (track.folderId !== folderId) continue
      queue.delete(track.id)
      counted.delete(track.id)
    }
  }

  set((state) => {
    const items = Object.fromEntries(
      Object.entries(state.items).filter(([, item]) => item.folderId !== folderId),
    )
    const idle = isIdle()
    return { items, total: idle ? 0 : state.total, done: idle ? 0 : state.done }
  })

  pruneRequested = true
  void deleteFolderRecords(folderId)
    .catch(() => {})
    .finally(pruneArtWhenIdle)
}

export async function initMetadata() {
  try {
    const items = await loadTrackMeta()
    set({ items: Object.fromEntries(items.map((item) => [item.id, item])) })
    cacheLoaded = true
  } catch {
    // 캐시를 못 읽어도 파일에서 다시 읽으면 된다.
  }

  useLibrary.subscribe((state, previous) => {
    if (state.tracks !== previous.tracks) {
      for (const [folderId, tracks] of Object.entries(state.tracks)) {
        if (tracks === previous.tracks[folderId]) continue
        forgetMissingTracks(folderId, tracks)
        enqueue(tracks)
      }
    }

    if (state.folders !== previous.folders) {
      const remaining = new Set(state.folders.map((folder) => folder.id))
      for (const { id } of previous.folders) {
        if (!remaining.has(id)) forgetFolder(id)
      }
    }
  })
}
