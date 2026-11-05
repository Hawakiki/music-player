import { Heart } from 'lucide-react'
import { useMemo } from 'react'
import { EmptyLibrary } from '@/components/library/EmptyLibrary'
import { PageHeader } from '@/components/library/PageHeader'
import { PlayButtons } from '@/components/library/PlayButtons'
import { TrackList } from '@/components/player/TrackList'
import { useLibraryIndex } from '@/hooks/use-library-index'
import { formatCount } from '@/lib/folders/status'
import { useFavorites } from '@/stores/favorites-store'

export function FavoritesPage() {
  const favorites = useFavorites((state) => state.items)
  const { trackById } = useLibraryIndex()

  const tracks = useMemo(
    () =>
      Object.entries(favorites)
        .sort(([, a], [, b]) => b - a)
        .flatMap(([id]) => trackById.get(id) ?? []),
    [favorites, trackById],
  )

  return (
    <>
      <PageHeader title="즐겨찾기" count={tracks.length > 0 ? `${formatCount(tracks.length)}곡` : undefined} />
      {tracks.length > 0 ? (
        <>
          <PlayButtons tracks={tracks} />
          <div className="mt-4">
            <TrackList tracks={tracks} />
          </div>
        </>
      ) : (
        <EmptyLibrary
          icon={Heart}
          message="즐겨찾기한 곡이 여기에 표시됩니다."
          emptyMessage="곡의 하트를 누르면 여기에 표시됩니다."
        />
      )}
    </>
  )
}
