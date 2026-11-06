import type { Playlist, PlaylistEntry } from './types'

const FORMAT = 'music-player-playlists'
const VERSION = 1

export interface ImportedPlaylist {
  name: string
  entries: PlaylistEntry[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value ? value : undefined
}

function toEntry(value: unknown): PlaylistEntry | null {
  if (!isRecord(value)) return null

  const { folder, path, title, artist, album } = value
  if (typeof folder !== 'string' || typeof path !== 'string') return null

  return {
    folder,
    path,
    title: optionalText(title),
    artist: optionalText(artist),
    album: optionalText(album),
  }
}

export function serializePlaylists(playlists: Playlist[]) {
  return JSON.stringify(
    {
      format: FORMAT,
      version: VERSION,
      playlists: playlists.map(({ name, entries }) => ({ name, entries })),
    },
    null,
    2,
  )
}

/** 형식이 맞지 않으면 null을 돌려준다. */
export function parsePlaylists(text: string): ImportedPlaylist[] | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }

  if (!isRecord(data) || data.format !== FORMAT || !Array.isArray(data.playlists)) return null

  const playlists: ImportedPlaylist[] = []
  for (const item of data.playlists) {
    if (!isRecord(item) || typeof item.name !== 'string' || !item.name.trim()) return null
    if (!Array.isArray(item.entries)) return null

    playlists.push({
      name: item.name.trim(),
      entries: item.entries.flatMap((entry) => toEntry(entry) ?? []),
    })
  }
  return playlists
}
