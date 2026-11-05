import type { SessionFile } from './types'

export const canRememberFolders = 'showDirectoryPicker' in window

const DROP_HANDLE_TIMEOUT_MS = 1500

export function isErrorNamed(error: unknown, name: string) {
  return error instanceof DOMException && error.name === name
}

/** 취소하면 null을 돌려준다. */
export async function pickDirectory() {
  try {
    return await window.showDirectoryPicker({ id: 'music-player', mode: 'read', startIn: 'music' })
  } catch (error) {
    if (isErrorNamed(error, 'AbortError')) return null
    throw error
  }
}

export interface PickedSessionFolder {
  name: string
  files: SessionFile[]
}

/** `showDirectoryPicker`가 없는 브라우저용. 취소하면 null을 돌려준다. */
export function pickDirectoryFiles() {
  return new Promise<PickedSessionFolder | null>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.webkitdirectory = true

    input.addEventListener('cancel', () => resolve(null))
    input.addEventListener('change', () => {
      const picked = [...(input.files ?? [])]
      if (picked.length === 0) {
        resolve(null)
        return
      }

      const [name] = picked[0].webkitRelativePath.split('/')
      const files = picked.map((file) => ({
        path: file.webkitRelativePath.slice(name.length + 1),
        file,
      }))
      resolve({ name, files })
    })

    input.click()
  })
}

function readEntryBatch(reader: FileSystemDirectoryReader) {
  return new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
}

function readEntryFile(entry: FileSystemFileEntry) {
  return new Promise<File>((resolve, reject) => entry.file(resolve, reject))
}

async function readDirectoryEntry(directory: FileSystemDirectoryEntry, prefix: string) {
  const files: SessionFile[] = []
  const reader = directory.createReader()

  // readEntries는 한 번에 일부만 돌려주므로 빈 배열이 나올 때까지 읽는다.
  for (let batch = await readEntryBatch(reader); batch.length > 0; batch = await readEntryBatch(reader)) {
    for (const entry of batch) {
      const path = `${prefix}${entry.name}`
      if (entry.isDirectory) {
        files.push(...(await readDirectoryEntry(entry as FileSystemDirectoryEntry, `${path}/`)))
      } else {
        files.push({ path, file: await readEntryFile(entry as FileSystemFileEntry) })
      }
    }
  }

  return files
}

export interface DropContents {
  directories: FileSystemDirectoryHandle[]
  sessionFolders: PickedSessionFolder[]
  looseFiles: SessionFile[]
}

function isDirectoryHandle(handle: FileSystemHandle | null): handle is FileSystemDirectoryHandle {
  return handle?.kind === 'directory'
}

/** 핸들을 얻지 못하면 null을 돌려줘서 `webkitGetAsEntry` 경로로 넘어가게 한다. */
function readHandle(item: DataTransferItem) {
  const pending = item.getAsFileSystemHandle?.()
  if (!pending) return Promise.resolve(null)

  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), DROP_HANDLE_TIMEOUT_MS))
  return Promise.race([pending.catch(() => null), timeout])
}

export async function readDrop(transfer: DataTransfer): Promise<DropContents> {
  // 드롭 이벤트가 끝나면 항목을 읽을 수 없으므로 첫 await 전에 모두 꺼낸다.
  const items = [...transfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => ({
      handle: readHandle(item),
      entry: item.webkitGetAsEntry(),
      file: item.getAsFile(),
    }))

  const contents: DropContents = { directories: [], sessionFolders: [], looseFiles: [] }

  for (const { handle: pendingHandle, entry, file } of items) {
    const handle = await pendingHandle
    if (isDirectoryHandle(handle)) {
      contents.directories.push(handle)
    } else if (!handle && entry?.isDirectory) {
      const files = await readDirectoryEntry(entry as FileSystemDirectoryEntry, '')
      contents.sessionFolders.push({ name: entry.name, files })
    } else if (file) {
      contents.looseFiles.push({ path: file.name, file })
    }
  }

  return contents
}
