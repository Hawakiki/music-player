import type { MusicFolder, TrackFile } from '@/lib/folders/types'
import { formatLabel, isPlayable } from '@/lib/metadata/format'
import type { TrackMeta } from '@/lib/metadata/types'
import { trackDirectory } from '@/lib/tracks'

const UNKNOWN_ARTIST = '알 수 없는 아티스트'
const VARIOUS_ARTISTS = '여러 아티스트'

export const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' })

export interface Album {
  id: string
  title: string
  artist: string
  artistId: string
  year?: number
  tracks: TrackFile[]
  artId?: string
  duration: number
  addedAt: number
  format?: string
}

export interface Artist {
  id: string
  name: string
  albums: Album[]
  tracks: TrackFile[]
  artId?: string
}

export interface Genre {
  id: string
  name: string
  tracks: TrackFile[]
  artId?: string
}

export interface LibraryIndex {
  albums: Album[]
  artists: Artist[]
  genres: Genre[]
  albumById: Map<string, Album>
  artistById: Map<string, Artist>
  genreById: Map<string, Genre>
  albumByTrack: Map<string, Album>
  trackById: Map<string, TrackFile>
  /** `폴더 이름\0경로`로 찾는다. */
  trackByLocation: Map<string, TrackFile>
  /** 파일을 옮겼을 때 태그로 찾는다. */
  trackByTags: Map<string, TrackFile>
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('ko')
}

export function getTagKey(title: string, artist = '', album = '') {
  return [title, artist, album].map(normalize).join('\0')
}

/** 주소에 쓸 짧고 항상 같은 id를 만든다 (cyrb53). */
function hashId(value: string) {
  let first = 0xdeadbeef
  let second = 0x41c6ce57

  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    first = Math.imul(first ^ code, 2654435761)
    second = Math.imul(second ^ code, 1597334677)
  }

  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909)
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909)
  return (4294967296 * (2097151 & second) + (first >>> 0)).toString(36)
}

function compareTracks(items: Record<string, TrackMeta>) {
  return (a: TrackFile, b: TrackFile) => {
    const left = items[a.id]
    const right = items[b.id]
    return (
      (left?.discNo ?? 1) - (right?.discNo ?? 1) ||
      (left?.trackNo ?? Number.MAX_SAFE_INTEGER) - (right?.trackNo ?? Number.MAX_SAFE_INTEGER) ||
      collator.compare(a.path, b.path)
    )
  }
}

function getDirectoryKey(track: TrackFile) {
  return `${track.folderId}/${trackDirectory(track)}`
}

/** 앨범 태그가 없으면 곡이 있는 폴더 이름을 앨범 이름으로 쓴다. */
function getFallbackAlbum(track: TrackFile, folderNames: Map<string, string>) {
  const directory = trackDirectory(track)
  return directory.slice(directory.lastIndexOf('/') + 1) || (folderNames.get(track.folderId) ?? '')
}

function getAlbumKey(track: TrackFile, meta: TrackMeta, compilations: Set<string>) {
  const directory = getDirectoryKey(track)
  if (!meta.album) return `dir|${directory}`

  const album = normalize(meta.album)
  if (meta.albumArtist) return `albumartist|${normalize(meta.albumArtist)}|${album}`
  if (compilations.has(`${directory}|${album}`)) return `compilation|${directory}|${album}`
  return `artist|${normalize(meta.artist ?? '')}|${album}`
}

/** 앨범 아티스트 태그 없이 한 폴더에 아티스트가 여럿인 앨범을 찾는다. */
function findCompilations(tracks: TrackFile[], items: Record<string, TrackMeta>) {
  const artists = new Map<string, Set<string>>()

  for (const track of tracks) {
    const meta = items[track.id]
    if (!meta.album || meta.albumArtist) continue

    const key = `${getDirectoryKey(track)}|${normalize(meta.album)}`
    const names = artists.get(key) ?? new Set()
    names.add(normalize(meta.artist ?? ''))
    artists.set(key, names)
  }

  return new Set([...artists].filter(([, names]) => names.size > 1).map(([key]) => key))
}

function getAlbumArtist(tracks: TrackFile[], items: Record<string, TrackMeta>) {
  const tagged = tracks.find((track) => items[track.id].albumArtist)
  if (tagged) return items[tagged.id].albumArtist as string

  const names = new Set(tracks.flatMap((track) => items[track.id].artist ?? []))
  if (names.size === 0) return UNKNOWN_ARTIST
  return names.size === 1 ? [...names][0] : VARIOUS_ARTISTS
}

function createAlbum(
  key: string,
  unsorted: TrackFile[],
  items: Record<string, TrackMeta>,
  folderNames: Map<string, string>,
): Album {
  const tracks = [...unsorted].sort(compareTracks(items))
  const metas = tracks.map((track) => items[track.id])
  const artist = getAlbumArtist(tracks, items)

  return {
    id: hashId(key),
    title: metas.find((meta) => meta.album)?.album ?? getFallbackAlbum(tracks[0], folderNames),
    artist,
    artistId: hashId(`artist|${normalize(artist)}`),
    year: metas.find((meta) => meta.year)?.year,
    tracks,
    artId: metas.find((meta) => meta.artId)?.artId,
    duration: metas.reduce((total, meta) => total + (meta.duration ?? 0), 0),
    addedAt: Math.max(...metas.map((meta) => meta.addedAt)),
    format: formatLabel(metas[0]),
  }
}

function buildArtists(albums: Album[]) {
  const artists = new Map<string, Artist>()

  for (const album of albums) {
    const artist = artists.get(album.artistId) ?? {
      id: album.artistId,
      name: album.artist,
      albums: [],
      tracks: [],
    }
    artist.albums.push(album)
    artist.tracks.push(...album.tracks)
    artist.artId ??= album.artId
    artists.set(album.artistId, artist)
  }

  for (const artist of artists.values()) {
    artist.albums.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || collator.compare(a.title, b.title))
  }
  return [...artists.values()].sort((a, b) => collator.compare(a.name, b.name))
}

function buildGenres(albums: Album[], items: Record<string, TrackMeta>) {
  const genres = new Map<string, Genre>()

  for (const album of albums) {
    for (const track of album.tracks) {
      for (const name of items[track.id].genres ?? []) {
        const key = normalize(name)
        const genre = genres.get(key) ?? { id: hashId(`genre|${key}`), name, tracks: [] }
        genre.tracks.push(track)
        genre.artId ??= album.artId
        genres.set(key, genre)
      }
    }
  }

  return [...genres.values()].sort((a, b) => collator.compare(a.name, b.name))
}

/** 태그를 읽은 곡만 올린다. 파일 이름으로 묶었다가 태그가 도착해서 뒤섞이는 일을 막는다. */
function buildLibrary(
  tracksByFolder: Record<string, TrackFile[]>,
  folders: MusicFolder[],
  items: Record<string, TrackMeta>,
): LibraryIndex {
  // 태그를 읽어 보니 재생할 수 없는 코덱인 곡은 어디에도 올리지 않는다. 재생목록에서는 못 찾은 곡이 된다.
  const allTracks = Object.values(tracksByFolder)
    .flat()
    .filter((track) => !items[track.id] || isPlayable(items[track.id]))
  const readTracks = allTracks.filter((track) => items[track.id])
  const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]))
  const compilations = findCompilations(readTracks, items)

  const groups = new Map<string, TrackFile[]>()
  for (const track of readTracks) {
    const key = getAlbumKey(track, items[track.id], compilations)
    const group = groups.get(key)
    if (group) group.push(track)
    else groups.set(key, [track])
  }

  const albums = [...groups].map(([key, tracks]) => createAlbum(key, tracks, items, folderNames))
  const artists = buildArtists(albums)
  const genres = buildGenres(albums, items)

  return {
    albums,
    artists,
    genres,
    albumById: new Map(albums.map((album) => [album.id, album])),
    artistById: new Map(artists.map((artist) => [artist.id, artist])),
    genreById: new Map(genres.map((genre) => [genre.id, genre])),
    albumByTrack: new Map(albums.flatMap((album) => album.tracks.map((track) => [track.id, album]))),
    trackById: new Map(allTracks.map((track) => [track.id, track])),
    trackByLocation: new Map(
      allTracks.map((track) => [`${folderNames.get(track.folderId)}\0${track.path}`, track]),
    ),
    trackByTags: new Map(
      readTracks.flatMap((track) => {
        const { title, artist, album } = items[track.id]
        return title ? [[getTagKey(title, artist, album), track] as const] : []
      }),
    ),
  }
}

let cached: { tracks: object; items: object; index: LibraryIndex } | null = null

/** 여러 화면이 같이 써도 곡 목록이나 태그가 바뀔 때만 다시 만든다. */
export function getLibraryIndex(
  tracksByFolder: Record<string, TrackFile[]>,
  folders: MusicFolder[],
  items: Record<string, TrackMeta>,
) {
  if (cached?.tracks !== tracksByFolder || cached.items !== items) {
    cached = { tracks: tracksByFolder, items, index: buildLibrary(tracksByFolder, folders, items) }
  }
  return cached.index
}
