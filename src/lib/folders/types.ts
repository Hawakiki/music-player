export type FolderStatus = 'scanning' | 'connected' | 'needs-permission' | 'missing' | 'session'

export interface MusicFolder {
  id: string
  name: string
  status: FolderStatus
  trackCount: number
  unsupportedCount: number
  addedAt: number
  /** 없으면 저장되지 않는 세션 폴더다. */
  handle?: FileSystemDirectoryHandle
}

export interface TrackFile {
  /** `폴더 id:상대 경로`. 다시 스캔해도 같은 값이 나온다. */
  id: string
  folderId: string
  path: string
  name: string
  source: FileSystemFileHandle | File
}

export interface SessionFile {
  path: string
  file: File
}
