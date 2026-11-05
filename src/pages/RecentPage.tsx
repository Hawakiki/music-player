import { Clock } from 'lucide-react'
import { useMemo } from 'react'
import { AlbumGrid } from '@/components/library/AlbumGrid'
import { EmptyLibrary } from '@/components/library/EmptyLibrary'
import { PageHeader } from '@/components/library/PageHeader'
import { useLibraryIndex } from '@/hooks/use-library-index'
import { collator } from '@/lib/library/build'

const MAX_ALBUMS = 100

export function RecentPage() {
  const { albums } = useLibraryIndex()
  const recent = useMemo(
    () =>
      [...albums]
        .sort((a, b) => b.addedAt - a.addedAt || collator.compare(a.title, b.title))
        .slice(0, MAX_ALBUMS),
    [albums],
  )

  return (
    <>
      <PageHeader title="최근 추가" />
      {recent.length > 0 ? (
        <AlbumGrid albums={recent} />
      ) : (
        <EmptyLibrary
          icon={Clock}
          message="최근에 추가된 곡이 여기에 표시됩니다."
          emptyMessage="최근에 추가된 곡이 없습니다."
        />
      )}
    </>
  )
}
