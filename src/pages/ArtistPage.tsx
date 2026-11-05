import { Navigate, useParams } from 'react-router-dom'
import { AlbumGrid } from '@/components/library/AlbumGrid'
import { PlayButtons } from '@/components/library/PlayButtons'
import { TrackArt } from '@/components/player/TrackArt'
import { useLibraryIndex } from '@/hooks/use-library-index'
import { useLibraryLoading } from '@/hooks/use-library-loading'
import { formatCount } from '@/lib/folders/status'

export function ArtistPage() {
  const { id = '' } = useParams()
  const { artistById } = useLibraryIndex()
  const loading = useLibraryLoading()
  const artist = artistById.get(id)

  if (!artist) return loading ? null : <Navigate to="/artists" replace />

  return (
    <>
      <div className="flex items-center gap-5">
        <TrackArt artId={artist.artId} className="size-24 rounded-full" />
        <div className="min-w-0">
          <h1 className="truncate text-title font-semibold">{artist.name}</h1>
          <p className="text-muted-foreground">
            앨범 {formatCount(artist.albums.length)}개, {formatCount(artist.tracks.length)}곡
          </p>
          <div className="mt-3">
            <PlayButtons tracks={artist.tracks} />
          </div>
        </div>
      </div>
      <div className="mt-6">
        <AlbumGrid albums={artist.albums} />
      </div>
    </>
  )
}
