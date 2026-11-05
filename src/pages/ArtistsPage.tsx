import { User } from 'lucide-react'
import { useMemo } from 'react'
import { EmptyLibrary } from '@/components/library/EmptyLibrary'
import { NameList } from '@/components/library/NameList'
import { PageHeader } from '@/components/library/PageHeader'
import { useLibraryIndex } from '@/hooks/use-library-index'
import { formatCount } from '@/lib/folders/status'

export function ArtistsPage() {
  const { artists } = useLibraryIndex()
  const items = useMemo(
    () =>
      artists.map(({ id, name, albums, tracks, artId }) => ({
        id,
        name,
        artId,
        detail: `앨범 ${formatCount(albums.length)}개, ${formatCount(tracks.length)}곡`,
        to: `/artists/${id}`,
      })),
    [artists],
  )

  return (
    <>
      <PageHeader title="아티스트" count={artists.length > 0 ? `${formatCount(artists.length)}명` : undefined} />
      {items.length > 0 ? (
        <NameList items={items} />
      ) : (
        <EmptyLibrary
          icon={User}
          message="폴더를 추가하면 아티스트가 여기에 표시됩니다."
          emptyMessage="폴더에서 아티스트를 찾지 못했습니다."
        />
      )}
    </>
  )
}
