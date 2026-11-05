import { useDeferredValue, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/library/PageHeader'
import { SearchField } from '@/components/library/SearchField'
import { TrackArt } from '@/components/player/TrackArt'
import { TrackList } from '@/components/player/TrackList'
import { useLibraryIndex } from '@/hooks/use-library-index'
import { useMetadata } from '@/stores/metadata-store'
import { formatCount } from '@/lib/folders/status'

const MAX_ARTISTS = 8
const MAX_ALBUMS = 12
const MAX_TRACKS = 100

function matches(query: string, ...values: (string | undefined)[]) {
  return values.some((value) => value?.toLocaleLowerCase('ko').includes(query))
}

export function SearchPage() {
  const [params] = useSearchParams()
  const query = useDeferredValue((params.get('q') ?? '').trim().toLocaleLowerCase('ko'))
  const { albums, artists, trackById } = useLibraryIndex()
  const items = useMetadata((state) => state.items)

  const results = useMemo(() => {
    if (!query) return null

    return {
      artists: artists.filter((artist) => matches(query, artist.name)).slice(0, MAX_ARTISTS),
      albums: albums.filter((album) => matches(query, album.title, album.artist)).slice(0, MAX_ALBUMS),
      tracks: [...trackById.values()]
        .filter((track) => {
          const meta = items[track.id]
          return matches(query, meta?.title, meta?.artist, meta?.album, track.name)
        })
        .slice(0, MAX_TRACKS),
    }
  }, [query, albums, artists, trackById, items])

  const empty = results && results.artists.length + results.albums.length + results.tracks.length === 0

  return (
    <>
      <PageHeader title="검색" />
      <SearchField className="mb-5 md:hidden" />

      {!results && <p className="text-muted-foreground">곡, 앨범, 아티스트 이름을 입력하세요.</p>}
      {empty && <p className="text-muted-foreground">검색 결과가 없습니다.</p>}

      {results && results.artists.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-base font-semibold">아티스트</h2>
          <ul>
            {results.artists.map(({ id, name, albums: artistAlbums, tracks, artId }) => (
              <li key={id}>
                <Link to={`/artists/${id}`} className="flex h-14 items-center gap-3 rounded-lg px-2 hover:bg-raised/60">
                  <TrackArt artId={artId} className="size-10 rounded-full" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{name}</span>
                    <span className="block truncate text-xs text-faint">
                      앨범 {formatCount(artistAlbums.length)}개, {formatCount(tracks.length)}곡
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {results && results.albums.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-base font-semibold">앨범</h2>
          <ul>
            {results.albums.map(({ id, title, artist, artId }) => (
              <li key={id}>
                <Link to={`/albums/${id}`} className="flex h-14 items-center gap-3 rounded-lg px-2 hover:bg-raised/60">
                  <TrackArt artId={artId} className="size-10" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{title}</span>
                    <span className="block truncate text-xs text-faint">{artist}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {results && results.tracks.length > 0 && (
        <section>
          <h2 className="mb-2 text-base font-semibold">곡</h2>
          <TrackList tracks={results.tracks} />
        </section>
      )}
    </>
  )
}
