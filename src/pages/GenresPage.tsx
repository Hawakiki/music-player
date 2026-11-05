import { Tag } from 'lucide-react'
import { useMemo } from 'react'
import { EmptyLibrary } from '@/components/library/EmptyLibrary'
import { NameList } from '@/components/library/NameList'
import { PageHeader } from '@/components/library/PageHeader'
import { useLibraryIndex } from '@/hooks/use-library-index'
import { formatCount } from '@/lib/folders/status'

export function GenresPage() {
  const { genres } = useLibraryIndex()
  const items = useMemo(
    () =>
      genres.map(({ id, name, tracks, artId }) => ({
        id,
        name,
        artId,
        detail: `${formatCount(tracks.length)}곡`,
        to: `/genres/${id}`,
      })),
    [genres],
  )

  return (
    <>
      <PageHeader title="장르" count={genres.length > 0 ? `${formatCount(genres.length)}개` : undefined} />
      {items.length > 0 ? (
        <NameList items={items} />
      ) : (
        <EmptyLibrary
          icon={Tag}
          message="폴더를 추가하면 장르가 여기에 표시됩니다."
          emptyMessage="장르 태그가 있는 곡이 없습니다."
        />
      )}
    </>
  )
}
