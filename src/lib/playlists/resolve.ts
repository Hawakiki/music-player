import type { TrackFile } from '@/lib/folders/types'
import { getTagKey, type LibraryIndex } from '@/lib/library/build'
import type { Playlist, PlaylistEntry } from './types'

export interface PlaylistRow {
  track: TrackFile
  entryIndex: number
}

/** 경로로 먼저 찾고, 파일을 옮겼으면 태그로 찾는다. */
function findTrack(library: LibraryIndex, entry: PlaylistEntry) {
  const byLocation = library.trackByLocation.get(`${entry.folder}\0${entry.path}`)
  if (byLocation) return byLocation

  return entry.title ? library.trackByTags.get(getTagKey(entry.title, entry.artist, entry.album)) : undefined
}

export function resolvePlaylist(playlist: Playlist, library: LibraryIndex) {
  const rows = playlist.entries.flatMap((entry, entryIndex): PlaylistRow[] => {
    const track = findTrack(library, entry)
    return track ? [{ track, entryIndex }] : []
  })

  return { rows, missing: playlist.entries.length - rows.length }
}
