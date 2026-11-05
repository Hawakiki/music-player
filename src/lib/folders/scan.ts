import type { SessionFile, TrackFile } from './types'

// 파일 이름으로만 고른다. 실제로 재생되는지는 재생할 때 확인한다.
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'weba'])
const UNSUPPORTED_EXTENSIONS = new Set(['aif', 'aiff', 'ape', 'dff', 'dsf', 'tak', 'wma', 'wv'])

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

function getExtension(name: string) {
  return name.slice(name.lastIndexOf('.') + 1).toLowerCase()
}

function createTrack(folderId: string, path: string, name: string, source: TrackFile['source']): TrackFile {
  return { id: `${folderId}:${path}`, folderId, path, name, source }
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
      }
    }
  }

  await walk(root, '')
  return { tracks: sortTracks(tracks), unsupportedCount }
}

export function scanSessionFiles(folderId: string, files: SessionFile[]): ScanResult {
  const tracks: TrackFile[] = []
  let unsupportedCount = 0

  for (const { path, file } of files) {
    if (path.split('/').some((part) => part.startsWith('.'))) continue

    const extension = getExtension(file.name)
    if (AUDIO_EXTENSIONS.has(extension)) {
      tracks.push(createTrack(folderId, path, file.name, file))
    } else if (UNSUPPORTED_EXTENSIONS.has(extension)) {
      unsupportedCount += 1
    }
  }

  return { tracks: sortTracks(tracks), unsupportedCount }
}
