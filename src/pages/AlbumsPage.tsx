import { Disc } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AlbumGrid } from '@/components/library/AlbumGrid'
import { EmptyLibrary } from '@/components/library/EmptyLibrary'
import { PageHeader } from '@/components/library/PageHeader'
import { useLibraryIndex } from '@/hooks/use-library-index'
import { formatCount } from '@/lib/folders/status'
import { collator, type Album } from '@/lib/library/build'

const SORT_KEY = 'music-player:album-sort'

type AlbumSort = 'artist' | 'title' | 'year' | 'recent'

const SORT_LABELS: Record<AlbumSort, string> = {
  artist: '아티스트순',
  title: '앨범순',
  year: '연도순',
  recent: '최근 추가순',
}

const COMPARE: Record<AlbumSort, (a: Album, b: Album) => number> = {
  artist: (a, b) => collator.compare(a.artist, b.artist) || collator.compare(a.title, b.title),
  title: (a, b) => collator.compare(a.title, b.title),
  year: (a, b) => (b.year ?? 0) - (a.year ?? 0) || collator.compare(a.title, b.title),
  recent: (a, b) => b.addedAt - a.addedAt || collator.compare(a.title, b.title),
}

const INDEX_BY: Partial<Record<AlbumSort, (album: Album) => string>> = {
  artist: (album) => album.artist,
  title: (album) => album.title,
}

function isAlbumSort(value: string | null): value is AlbumSort {
  return value !== null && value in SORT_LABELS
}

function readSort(): AlbumSort {
  try {
    const stored = localStorage.getItem(SORT_KEY)
    return isAlbumSort(stored) ? stored : 'artist'
  } catch {
    return 'artist'
  }
}

export function AlbumsPage() {
  const { albums } = useLibraryIndex()
  const [sort, setSort] = useState(readSort)
  const sorted = useMemo(() => [...albums].sort(COMPARE[sort]), [albums, sort])

  function changeSort(next: AlbumSort) {
    setSort(next)
    try {
      localStorage.setItem(SORT_KEY, next)
    } catch {
      // 저장하지 못해도 이번 방문에는 적용된다.
    }
  }

  return (
    <>
      <PageHeader title="앨범" count={albums.length > 0 ? `${formatCount(albums.length)}개` : undefined}>
        {albums.length > 0 && (
          <select
            aria-label="정렬"
            value={sort}
            onChange={(event) => {
              if (isAlbumSort(event.target.value)) changeSort(event.target.value)
            }}
            className="h-9 rounded-lg bg-raised px-3 outline-none"
          >
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        )}
      </PageHeader>
      {sorted.length > 0 ? (
        <AlbumGrid albums={sorted} indexBy={INDEX_BY[sort]} />
      ) : (
        <EmptyLibrary
          icon={Disc}
          message="폴더를 추가하면 앨범이 여기에 표시됩니다."
          emptyMessage="폴더에서 앨범을 찾지 못했습니다."
        />
      )}
    </>
  )
}
