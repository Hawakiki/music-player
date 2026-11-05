import { Navigate, useParams } from 'react-router-dom'
import { PageHeader } from '@/components/library/PageHeader'
import { PlayButtons } from '@/components/library/PlayButtons'
import { TrackList } from '@/components/player/TrackList'
import { useLibraryIndex } from '@/hooks/use-library-index'
import { useLibraryLoading } from '@/hooks/use-library-loading'
import { formatCount } from '@/lib/folders/status'

export function GenrePage() {
  const { id = '' } = useParams()
  const { genreById } = useLibraryIndex()
  const loading = useLibraryLoading()
  const genre = genreById.get(id)

  if (!genre) return loading ? null : <Navigate to="/genres" replace />

  return (
    <>
      <PageHeader title={genre.name} count={`${formatCount(genre.tracks.length)}곡`} />
      <PlayButtons tracks={genre.tracks} />
      <div className="mt-4">
        <TrackList tracks={genre.tracks} />
      </div>
    </>
  )
}
