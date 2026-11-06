import type { TrackCover, TrackFile } from '@/lib/folders/types'

/** 읽는 값이 늘면 올린다. 이전 버전으로 저장된 곡은 다시 읽는다. */
export const META_VERSION = 2

export interface ReadTags {
  version?: number
  size: number
  lastModified: number
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  genres?: string[]
  year?: number
  trackNo?: number
  discNo?: number
  duration?: number
  bitrate?: number
  sampleRate?: number
  bitsPerSample?: number
  codec?: string
  lossless?: boolean
  trackGain?: number
  trackPeak?: number
  albumGain?: number
  albumPeak?: number
  artId?: string
}

export interface TrackMeta extends ReadTags {
  id: string
  folderId: string
  addedAt: number
}

export interface ReadJob {
  kind: 'read'
  id: string
  source: TrackFile['source']
  cover?: TrackCover
  /** 이 값과 파일이 같으면 다시 읽지 않는다. */
  known?: { size: number; lastModified: number }
}

export interface CoverJob {
  kind: 'cover'
  id: string
  source: TrackFile['source']
  cover?: TrackCover
}

export type WorkerJob = ReadJob | CoverJob

export type ReadResult =
  | { id: string; kind: 'read'; tags: ReadTags }
  | { id: string; kind: 'unchanged' }
  | { id: string; kind: 'unavailable' }

export interface CoverResult {
  id: string
  kind: 'cover'
  image: Blob | null
}

export type WorkerResult = ReadResult | CoverResult
