import { Link, Navigate, useParams } from 'react-router-dom'
import { AlbumGrid } from '@/components/library/AlbumGrid'
import { PlayButtons } from '@/components/library/PlayButtons'
import { TrackArt } from '@/components/player/TrackArt'
import { TrackList } from '@/components/player/TrackList'
import { useLibraryIndex } from '@/hooks/use-library-index'
import { useLibraryLoading } from '@/hooks/use-library-loading'
import { formatTotalTime } from '@/lib/metadata/format'

export function AlbumPage() {
  const { id = '' } = useParams()
  const { albumById, artistById } = useLibraryIndex()
  const loading = useLibraryLoading()
  const album = albumById.get(id)

  if (!album) return loading ? null : <Navigate to="/albums" replace />

  const details = [album.year && `${album.year}년`, `${album.tracks.length}곡`]
  if (album.duration > 0) details.push(formatTotalTime(album.duration))
  const others = artistById.get(album.artistId)?.albums.filter((item) => item.id !== album.id) ?? []

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
        <TrackArt artId={album.artId} className="size-44" />
        <div className="min-w-0">
          <h1 className="text-title leading-tight font-semibold">{album.title}</h1>
          <Link to={`/artists/${album.artistId}`} className="text-muted-foreground hover:text-foreground">
            {album.artist}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <span className="text-caption text-faint">{details.filter(Boolean).join(', ')}</span>
            {album.format && (
              <span className="rounded-sm bg-raised px-2 text-xs leading-5 text-muted-foreground">{album.format}</span>
            )}
          </div>
          <div className="mt-4">
            <PlayButtons tracks={album.tracks} label={album.title} />
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex h-8 items-center border-b text-xs text-faint">
          <div className="flex min-w-0 flex-1 items-center gap-3 px-3">
            <span className="w-7 shrink-0">#</span>
            <span className="flex-1">제목</span>
            <span className="hidden w-1/4 shrink-0 sm:block">아티스트</span>
          </div>
          <span className="w-16 shrink-0" />
          <span className="w-12 shrink-0 pr-3 text-right">시간</span>
        </div>
        <div className="mt-1">
          <TrackList tracks={album.tracks} album />
        </div>
      </div>

      {others.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-base font-semibold">{album.artist}의 다른 앨범</h2>
          <AlbumGrid albums={others} />
        </section>
      )}
    </>
  )
}
