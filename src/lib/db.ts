import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { TrackMeta } from '@/lib/metadata/types'
import type { Playlist } from '@/lib/playlists/types'

export interface StoredFolder {
  id: string
  name: string
  handle: FileSystemDirectoryHandle
  addedAt: number
}

export interface StoredFavorite {
  id: string
  folderId: string
  addedAt: number
}

export interface StoredWave {
  id: string
  folderId: string
  size: number
  lastModified: number
  peaks: Uint8Array
}

interface MusicPlayerDB extends DBSchema {
  folders: { key: string; value: StoredFolder }
  tracks: { key: string; value: TrackMeta; indexes: { folderId: string } }
  art: { key: string; value: Blob }
  favorites: { key: string; value: StoredFavorite; indexes: { folderId: string } }
  waves: { key: string; value: StoredWave; indexes: { folderId: string } }
  playlists: { key: string; value: Playlist }
}

let connection: Promise<IDBPDatabase<MusicPlayerDB>> | undefined

function getDb() {
  connection ??= openDB<MusicPlayerDB>('music-player', 3, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('folders', { keyPath: 'id' })
      }
      if (oldVersion < 2) {
        db.createObjectStore('tracks', { keyPath: 'id' }).createIndex('folderId', 'folderId')
        db.createObjectStore('art')
        db.createObjectStore('favorites', { keyPath: 'id' }).createIndex('folderId', 'folderId')
      }
      if (oldVersion < 3) {
        db.createObjectStore('waves', { keyPath: 'id' }).createIndex('folderId', 'folderId')
        db.createObjectStore('playlists', { keyPath: 'id' })
      }
    },
    // 다른 탭이 새 버전으로 올리려 할 때 막지 않도록 연결을 닫는다.
    blocking(_currentVersion, _blockedVersion, event) {
      ;(event.target as IDBDatabase).close()
      connection = undefined
    },
  })
  return connection
}

export async function loadFolders() {
  const folders = await (await getDb()).getAll('folders')
  return folders.sort((a, b) => a.addedAt - b.addedAt)
}

export async function saveFolder(folder: StoredFolder) {
  await (await getDb()).put('folders', folder)
}

export async function deleteFolder(id: string) {
  await (await getDb()).delete('folders', id)
}

export async function loadTrackMeta() {
  return (await getDb()).getAll('tracks')
}

export async function saveTrackMeta(items: TrackMeta[]) {
  const transaction = (await getDb()).transaction('tracks', 'readwrite')
  await Promise.all([...items.map((item) => transaction.store.put(item)), transaction.done])
}

export async function deleteTrackMeta(ids: string[]) {
  const transaction = (await getDb()).transaction('tracks', 'readwrite')
  await Promise.all([...ids.map((id) => transaction.store.delete(id)), transaction.done])
}

/** 폴더를 제거할 때 그 폴더의 곡 정보, 즐겨찾기, 파형을 지운다. */
export async function deleteFolderRecords(folderId: string) {
  const transaction = (await getDb()).transaction(['tracks', 'favorites', 'waves'], 'readwrite')
  const tracks = transaction.objectStore('tracks')
  const favorites = transaction.objectStore('favorites')
  const waves = transaction.objectStore('waves')

  const [trackIds, favoriteIds, waveIds] = await Promise.all([
    tracks.index('folderId').getAllKeys(folderId),
    favorites.index('folderId').getAllKeys(folderId),
    waves.index('folderId').getAllKeys(folderId),
  ])
  await Promise.all([
    ...trackIds.map((id) => tracks.delete(id)),
    ...favoriteIds.map((id) => favorites.delete(id)),
    ...waveIds.map((id) => waves.delete(id)),
    transaction.done,
  ])
}

export async function loadArt(id: string) {
  return (await getDb()).get('art', id)
}

export async function hasArt(id: string) {
  return (await (await getDb()).getKey('art', id)) !== undefined
}

export async function saveArt(id: string, image: Blob) {
  await (await getDb()).put('art', image, id)
}

/** 지금 쓰는 표지만 남긴다. */
export async function pruneArt(used: Set<string>) {
  const db = await getDb()
  const unused = (await db.getAllKeys('art')).filter((id) => !used.has(id))

  const transaction = db.transaction('art', 'readwrite')
  await Promise.all([...unused.map((id) => transaction.store.delete(id)), transaction.done])
}

export async function loadWave(id: string) {
  return (await getDb()).get('waves', id)
}

export async function saveWave(wave: StoredWave) {
  await (await getDb()).put('waves', wave)
}

export async function loadPlaylists() {
  return (await getDb()).getAll('playlists')
}

export async function savePlaylist(playlist: Playlist) {
  await (await getDb()).put('playlists', playlist)
}

export async function deletePlaylist(id: string) {
  await (await getDb()).delete('playlists', id)
}

export async function loadFavorites() {
  return (await getDb()).getAll('favorites')
}

export async function saveFavorite(favorite: StoredFavorite) {
  await (await getDb()).put('favorites', favorite)
}

export async function deleteFavorite(id: string) {
  await (await getDb()).delete('favorites', id)
}
