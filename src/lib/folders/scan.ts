import { getExtension } from '@/lib/tracks'
import type { SessionFile, TrackCover, TrackFile } from './types'

// 파일 이름으로만 고른다. 실제로 재생되는지는 재생할 때 확인한다.
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'm4b', 'mka', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'weba'])
const UNSUPPORTED_EXTENSIONS = new Set(['aif', 'aiff', 'ape', 'dff', 'dsf', 'tak', 'wma', 'wv'])

const IMAGE_EXTENSIONS = new Set(['jpeg', 'jpg', 'png', 'webp'])
const COVER_NAMES = new Set(['album', 'albumart', 'cover', 'folder', 'front'])

const PROGRESS_INTERVAL = 200

const collator = new Intl.Collator('ko', { numeric: true })

export interface ScanResult {
  tracks: TrackFile[]
  unsupportedCount: number
}

interface ScanOptions {
  signal: AbortSignal
  onProgress: (trackCount: number) => void
}

function isCoverFile(name: string) {
  const dot = name.lastIndexOf('.')
  return (
    dot > 0 &&
    IMAGE_EXTENSIONS.has(getExtension(name)) &&
    COVER_NAMES.has(name.slice(0, dot).toLowerCase())
  )
}

function createTrack(folderId: string, path: string, name: string, source: TrackFile['source']): TrackFile {
  return { id: `${folderId}:${path}`, folderId, path, name, source }
}

/** 곡이 있는 폴더, 없으면 바로 위 폴더(CD1, CD2로 나뉜 앨범)의 이미지를 붙인다. */
function attachCovers(folderId: string, tracks: TrackFile[], covers: Map<string, TrackCover['source']>) {
  if (covers.size === 0) return

  for (const track of tracks) {
    const directory = track.path.slice(0, track.path.length - track.name.length)
    const parent = directory.slice(0, directory.lastIndexOf('/', directory.length - 2) + 1)
    const prefix = covers.has(directory) ? directory : parent
    const source = covers.get(prefix)
    if (source) track.cover = { key: `${folderId}:${prefix}`, source }
  }
}

function sortTracks(tracks: TrackFile[]) {
  return tracks.sort((a, b) => collator.compare(a.path, b.path))
}

export async function scanDirectory(
  folderId: string,
  root: FileSystemDirectoryHandle,
  { signal, onProgress }: ScanOptions,
): Promise<ScanResult> {
  const tracks: TrackFile[] = []
  const covers = new Map<string, TrackCover['source']>()
  let unsupportedCount = 0

  async function walk(directory: FileSystemDirectoryHandle, prefix: string) {
    for await (const entry of directory.values()) {
      signal.throwIfAborted()
      if (entry.name.startsWith('.')) continue

      const path = `${prefix}${entry.name}`
      if (entry.kind === 'directory') {
        await walk(entry, `${path}/`)
        continue
      }

      const extension = getExtension(entry.name)
      if (AUDIO_EXTENSIONS.has(extension)) {
        tracks.push(createTrack(folderId, path, entry.name, entry))
        if (tracks.length % PROGRESS_INTERVAL === 0) onProgress(tracks.length)
      } else if (UNSUPPORTED_EXTENSIONS.has(extension)) {
        unsupportedCount += 1
      } else if (isCoverFile(entry.name) && !covers.has(prefix)) {
        covers.set(prefix, entry)
      }
    }
  }

  await walk(root, '')
  attachCovers(folderId, tracks, covers)
  return { tracks: sortTracks(tracks), unsupportedCount }
}

export function scanSessionFiles(folderId: string, files: SessionFile[]): ScanResult {
  const tracks: TrackFile[] = []
  const covers = new Map<string, TrackCover['source']>()
  let unsupportedCount = 0

  for (const { path, file } of files) {
    if (path.split('/').some((part) => part.startsWith('.'))) continue

    const extension = getExtension(file.name)
    if (AUDIO_EXTENSIONS.has(extension)) {
      tracks.push(createTrack(folderId, path, file.name, file))
    } else if (UNSUPPORTED_EXTENSIONS.has(extension)) {
      unsupportedCount += 1
    } else if (isCoverFile(file.name)) {
      const prefix = path.slice(0, path.length - file.name.length)
      if (!covers.has(prefix)) covers.set(prefix, file)
    }
  }

  attachCovers(folderId, tracks, covers)
  return { tracks: sortTracks(tracks), unsupportedCount }
}
