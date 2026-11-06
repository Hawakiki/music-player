import { create } from 'zustand'
import { deletePlaylist, loadPlaylists, savePlaylist } from '@/lib/db'
import type { TrackFile } from '@/lib/folders/types'
import { parsePlaylists, serializePlaylists } from '@/lib/playlists/file'
import type { Playlist, PlaylistEntry } from '@/lib/playlists/types'
import { notify, useLibrary } from '@/stores/library-store'
import { useMetadata } from '@/stores/metadata-store'

const EXPORT_FILE_NAME = 'music-player-playlists.json'

interface PlaylistsState {
  ready: boolean
  playlists: Playlist[]
  /** 값이 있으면 새 재생목록 창을 연다. 만든 뒤 이 곡들을 넣는다. */
  creating: TrackFile[] | null
}

export const usePlaylists = create<PlaylistsState>(() => ({ ready: false, playlists: [], creating: null }))

const { getState: get, setState: set } = usePlaylists

function persist(playlist: Playlist) {
  savePlaylist(playlist).catch(() => notify('재생목록을 저장하지 못했습니다.'))
}

function update(id: string, change: (playlist: Playlist) => Partial<Playlist>) {
  const current = get().playlists.find((playlist) => playlist.id === id)
  if (!current) return

  const next = { ...current, ...change(current), updatedAt: Date.now() }
  set((state) => ({ playlists: state.playlists.map((item) => (item.id === id ? next : item)) }))
  persist(next)
}

function toEntries(tracks: TrackFile[]) {
  const { folders } = useLibrary.getState()
  const { items } = useMetadata.getState()

  return tracks.map((track): PlaylistEntry => {
    const meta = items[track.id]
    return {
      folder: folders.find((folder) => folder.id === track.folderId)?.name ?? '',
      path: track.path,
      title: meta?.title,
      artist: meta?.artist,
      album: meta?.album,
    }
  })
}

function uniqueName(name: string, taken: Set<string>) {
  if (!taken.has(name)) return name

  let suffix = 2
  while (taken.has(`${name} (${suffix})`)) suffix += 1
  return `${name} (${suffix})`
}

function addPlaylist(name: string, entries: PlaylistEntry[]) {
  const taken = new Set(get().playlists.map((playlist) => playlist.name))
  const now = Date.now()
  const playlist: Playlist = {
    id: crypto.randomUUID(),
    name: uniqueName(name, taken),
    entries,
    createdAt: now,
    updatedAt: now,
  }

  set((state) => ({ playlists: [...state.playlists, playlist] }))
  persist(playlist)
  return playlist
}

export function openCreatePlaylist(tracks: TrackFile[] = []) {
  set({ creating: tracks })
}

export function closeCreatePlaylist() {
  set({ creating: null })
}

export function createPlaylist(name: string) {
  const playlist = addPlaylist(name, toEntries(get().creating ?? []))
  set({ creating: null })
  notify(`재생목록을 만들었습니다: ${playlist.name}`)
  return playlist
}

export function renamePlaylist(id: string, name: string) {
  update(id, () => ({ name }))
}

export function removePlaylist(id: string) {
  set((state) => ({ playlists: state.playlists.filter((playlist) => playlist.id !== id) }))
  deletePlaylist(id).catch(() => notify('재생목록을 삭제하지 못했습니다.'))
}

export function addToPlaylist(id: string, tracks: TrackFile[]) {
  const name = get().playlists.find((playlist) => playlist.id === id)?.name
  update(id, ({ entries }) => ({ entries: [...entries, ...toEntries(tracks)] }))
  notify(`재생목록에 추가했습니다: ${name}`)
}

export function removeEntry(id: string, index: number) {
  update(id, ({ entries }) => ({ entries: entries.toSpliced(index, 1) }))
}

/** `before` 위치 앞으로 옮긴다. 끝으로 옮기려면 목록 길이를 넘긴다. */
export function moveEntry(id: string, from: number, before: number) {
  update(id, ({ entries }) => {
    const moved = entries[from]
    const target = before > from ? before - 1 : before
    return { entries: entries.toSpliced(from, 1).toSpliced(target, 0, moved) }
  })
}

export function exportPlaylists(playlists: Playlist[]) {
  const url = URL.createObjectURL(new Blob([serializePlaylists(playlists)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = EXPORT_FILE_NAME
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function pickJsonFile() {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.addEventListener('cancel', () => resolve(null))
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null))
    input.click()
  })
}

export async function importPlaylists() {
  const file = await pickJsonFile()
  if (!file) return

  const imported = parsePlaylists(await file.text())
  if (!imported) {
    notify('재생목록 파일이 아닙니다. 이 앱에서 내보낸 파일을 고르세요.')
    return
  }

  for (const { name, entries } of imported) addPlaylist(name, entries)
  notify(`재생목록 ${imported.length}개를 가져왔습니다.`)
}

export async function initPlaylists() {
  try {
    const playlists = await loadPlaylists()
    set({ playlists: playlists.sort((a, b) => a.createdAt - b.createdAt) })
  } catch {
    notify('재생목록을 불러오지 못했습니다.')
  }
  set({ ready: true })
}
