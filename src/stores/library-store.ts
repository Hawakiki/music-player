import { create } from 'zustand'
import {
  canRememberFolders,
  isErrorNamed,
  pickDirectory,
  pickDirectoryFiles,
  readDrop,
} from '@/lib/folders/access'
import { deleteFolder, loadFolders, saveFolder } from '@/lib/folders/db'
import { scanDirectory, scanSessionFiles } from '@/lib/folders/scan'
import type { MusicFolder, SessionFile, TrackFile } from '@/lib/folders/types'

const LOOSE_FILES_ID = 'session-files'

interface Notice {
  id: number
  text: string
}

interface LibraryState {
  /** 저장된 폴더 목록을 불러왔는지 여부. */
  ready: boolean
  folders: MusicFolder[]
  tracks: Record<string, TrackFile[]>
  notice: Notice | null
}

export const useLibrary = create<LibraryState>(() => ({
  ready: false,
  folders: [],
  tracks: {},
  notice: null,
}))

const scans = new Map<string, AbortController>()
let noticeId = 0

export function notify(text: string) {
  noticeId += 1
  useLibrary.setState({ notice: { id: noticeId, text } })
}

export function clearNotice(id: number) {
  useLibrary.setState((state) => (state.notice?.id === id ? { notice: null } : state))
}

function getFolder(id: string) {
  return useLibrary.getState().folders.find((folder) => folder.id === id)
}

function patchFolder(id: string, patch: Partial<MusicFolder>) {
  useLibrary.setState((state) => ({
    folders: state.folders.map((folder) => (folder.id === id ? { ...folder, ...patch } : folder)),
  }))
}

function setTracks(id: string, tracks: TrackFile[] | undefined) {
  useLibrary.setState((state) => {
    const next = { ...state.tracks }
    if (tracks) next[id] = tracks
    else delete next[id]
    return { tracks: next }
  })
}

async function persistFolder(id: string) {
  const folder = getFolder(id)
  if (!folder?.handle) return

  const { name, handle, addedAt } = folder
  await saveFolder({ id, name, handle, addedAt })
}

async function runScan(id: string, handle: FileSystemDirectoryHandle) {
  scans.get(id)?.abort()
  const controller = new AbortController()
  scans.set(id, controller)
  patchFolder(id, { status: 'scanning', trackCount: 0, unsupportedCount: 0 })

  try {
    const { tracks, unsupportedCount } = await scanDirectory(id, handle, {
      signal: controller.signal,
      onProgress: (trackCount) => patchFolder(id, { trackCount }),
    })
    controller.signal.throwIfAborted()
    setTracks(id, tracks)
    patchFolder(id, { status: 'connected', trackCount: tracks.length, unsupportedCount })
  } catch (error) {
    if (controller.signal.aborted) return

    setTracks(id, undefined)
    if (isErrorNamed(error, 'NotAllowedError')) {
      patchFolder(id, { status: 'needs-permission', trackCount: 0 })
    } else {
      patchFolder(id, { status: 'missing', trackCount: 0 })
    }
  } finally {
    if (scans.get(id) === controller) scans.delete(id)
  }
}

/** 겹치는 폴더가 있으면 안내 문구를, 없으면 null을 돌려준다. */
async function findOverlap(handle: FileSystemDirectoryHandle, ignoreId?: string) {
  for (const folder of useLibrary.getState().folders) {
    if (!folder.handle || folder.id === ignoreId) continue

    if (await folder.handle.isSameEntry(handle)) return `이미 추가된 폴더입니다: ${folder.name}`
    if (await folder.handle.resolve(handle)) return `이미 추가된 폴더 안에 있습니다: ${folder.name}`
    if (await handle.resolve(folder.handle)) {
      return `이 폴더 안에 이미 추가된 폴더가 있습니다: ${folder.name}`
    }
  }
  return null
}

async function addDirectory(handle: FileSystemDirectoryHandle) {
  const overlap = await findOverlap(handle)
  if (overlap) {
    notify(overlap)
    return
  }

  const folder: MusicFolder = {
    id: crypto.randomUUID(),
    name: handle.name,
    status: 'scanning',
    trackCount: 0,
    unsupportedCount: 0,
    addedAt: Date.now(),
    handle,
  }
  useLibrary.setState((state) => ({ folders: [...state.folders, folder] }))
  void navigator.storage?.persist?.()

  await persistFolder(folder.id)
  await runScan(folder.id, handle)
}

function addSessionFolder(id: string, name: string, files: SessionFile[]) {
  const { tracks, unsupportedCount } = scanSessionFiles(id, files)
  if (tracks.length === 0) {
    notify(`오디오 파일을 찾지 못했습니다: ${name}`)
    return
  }

  const existing = useLibrary.getState().tracks[id] ?? []
  const added = tracks.filter((track) => !existing.some(({ path }) => path === track.path))
  const merged = [...existing, ...added]

  setTracks(id, merged)
  if (getFolder(id)) {
    patchFolder(id, { trackCount: merged.length })
    return
  }

  const folder: MusicFolder = {
    id,
    name,
    status: 'session',
    trackCount: merged.length,
    unsupportedCount,
    addedAt: Date.now(),
  }
  useLibrary.setState((state) => ({ folders: [...state.folders, folder] }))
}

export async function restoreFolders() {
  if (!canRememberFolders) {
    useLibrary.setState({ ready: true })
    return
  }

  try {
    const stored = await loadFolders()
    const restored = stored.map(
      (folder): MusicFolder => ({
        ...folder,
        status: 'needs-permission',
        trackCount: 0,
        unsupportedCount: 0,
      }),
    )
    useLibrary.setState((state) => ({ ready: true, folders: [...restored, ...state.folders] }))

    await Promise.all(
      stored.map(async ({ id, handle }) => {
        const permission = await handle.queryPermission({ mode: 'read' })
        if (permission === 'granted') await runScan(id, handle)
      }),
    )
  } catch {
    useLibrary.setState({ ready: true })
    notify('저장된 폴더를 불러오지 못했습니다.')
  }
}

export async function addFolder() {
  try {
    if (canRememberFolders) {
      const handle = await pickDirectory()
      if (handle) await addDirectory(handle)
      return
    }

    const picked = await pickDirectoryFiles()
    if (picked) addSessionFolder(crypto.randomUUID(), picked.name, picked.files)
  } catch {
    notify('폴더를 추가하지 못했습니다.')
  }
}

export async function addFromDrop(transfer: DataTransfer) {
  try {
    const { directories, sessionFolders, looseFiles } = await readDrop(transfer)

    for (const directory of directories) await addDirectory(directory)
    for (const { name, files } of sessionFolders) addSessionFolder(crypto.randomUUID(), name, files)
    if (looseFiles.length > 0) addSessionFolder(LOOSE_FILES_ID, '가져온 파일', looseFiles)
  } catch {
    notify('끌어온 항목을 읽지 못했습니다.')
  }
}

export async function reconnectFolder(id: string) {
  const handle = getFolder(id)?.handle
  if (!handle) return

  try {
    // requestPermission은 클릭 안에서만 동작하므로 이 앞에 await를 두지 않는다.
    const permission = await handle.requestPermission({ mode: 'read' })
    if (permission === 'granted') await runScan(id, handle)
    else notify('폴더 접근이 허용되지 않았습니다.')
  } catch {
    notify('폴더를 다시 연결하지 못했습니다.')
  }
}

export async function reselectFolder(id: string) {
  try {
    const handle = await pickDirectory()
    if (!handle) return

    const overlap = await findOverlap(handle, id)
    if (overlap) {
      notify(overlap)
      return
    }

    patchFolder(id, { name: handle.name, handle })
    await persistFolder(id)
    await runScan(id, handle)
  } catch {
    notify('폴더를 다시 선택하지 못했습니다.')
  }
}

export async function rescanFolder(id: string) {
  const handle = getFolder(id)?.handle
  if (!handle) return

  try {
    const permission = await handle.queryPermission({ mode: 'read' })
    if (permission === 'granted') {
      await runScan(id, handle)
      return
    }

    setTracks(id, undefined)
    patchFolder(id, { status: 'needs-permission', trackCount: 0 })
  } catch {
    notify('폴더를 다시 검색하지 못했습니다.')
  }
}

export async function removeFolder(id: string) {
  const folder = getFolder(id)
  if (!folder) return

  scans.get(id)?.abort()
  setTracks(id, undefined)
  useLibrary.setState((state) => ({ folders: state.folders.filter((item) => item.id !== id) }))

  if (!folder.handle) return
  try {
    await deleteFolder(id)
  } catch {
    notify('폴더 목록을 저장하지 못했습니다. 새로고침하면 다시 보일 수 있습니다.')
  }
}
