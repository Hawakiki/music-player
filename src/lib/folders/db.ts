import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export interface StoredFolder {
  id: string
  name: string
  handle: FileSystemDirectoryHandle
  addedAt: number
}

interface MusicPlayerDB extends DBSchema {
  folders: { key: string; value: StoredFolder }
}

let connection: Promise<IDBPDatabase<MusicPlayerDB>> | undefined

function getDb() {
  connection ??= openDB<MusicPlayerDB>('music-player', 1, {
    upgrade(db) {
      db.createObjectStore('folders', { keyPath: 'id' })
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
