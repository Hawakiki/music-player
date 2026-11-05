import { useVirtualizer } from '@tanstack/react-virtual'
import { AudioLines } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { IndexRail } from '@/components/library/IndexRail'
import { useElementWidth, useMainScroll, useScrollMargin } from '@/components/layout/main-scroll'
import { TrackArt } from '@/components/player/TrackArt'
import { useLibraryIndex } from '@/hooks/use-library-index'
import type { Album } from '@/lib/library/build'
import { buildIndex } from '@/lib/library/initials'
import { cn } from '@/lib/utils'
import { usePlayer } from '@/stores/player-store'

const MIN_TILE_WIDTH = 160
const COLUMN_GAP = 20
const ROW_GAP = 24
const TEXT_HEIGHT = 52

interface AlbumTileProps {
  album: Album
  playing: boolean
}

function AlbumTile({ album, playing }: AlbumTileProps) {
  return (
    <Link to={`/albums/${album.id}`} className="block min-w-0 rounded-md">
      <div className="relative">
        <TrackArt artId={album.artId} className="aspect-square w-full" />
        {playing && (
          <span className="absolute right-2 bottom-2 grid size-7 place-items-center rounded-md bg-panel text-point">
            <AudioLines aria-label="재생 중" className="size-4" />
          </span>
        )}
      </div>
      <p className={cn('mt-2 truncate font-medium', playing && 'text-point')}>{album.title}</p>
      <p className="truncate text-caption text-faint">{album.artist}</p>
    </Link>
  )
}

interface AlbumGridProps {
  albums: Album[]
  /** 지정하면 이 이름의 첫 글자로 이동하는 인덱스를 보여 준다. */
  indexBy?: (album: Album) => string
}

export function AlbumGrid({ albums, indexBy }: AlbumGridProps) {
  const main = useMainScroll()
  const gridRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(gridRef)
  const scrollMargin = useScrollMargin(gridRef)
  const { albumByTrack } = useLibraryIndex()
  const playingId = usePlayer((state) => {
    const track = state.queue[state.index]
    return track && albumByTrack.get(track.id)?.id
  })

  const columns = Math.max(2, Math.floor((width + COLUMN_GAP) / (MIN_TILE_WIDTH + COLUMN_GAP)))
  const tileWidth = (width - COLUMN_GAP * (columns - 1)) / columns
  const rowHeight = tileWidth + TEXT_HEIGHT + ROW_GAP

  const virtualizer = useVirtualizer({
    count: Math.ceil(albums.length / columns),
    getScrollElement: () => main,
    estimateSize: () => rowHeight,
    overscan: 2,
    scrollMargin,
  })

  useEffect(() => {
    virtualizer.measure()
  }, [virtualizer, rowHeight])

  const entries = useMemo(() => (indexBy ? buildIndex(albums, indexBy) : []), [albums, indexBy])

  return (
    <div className="flex items-start gap-3">
      <div ref={gridRef} className="relative min-w-0 flex-1" style={{ height: virtualizer.getTotalSize() }}>
        {width > 0 &&
          virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.key}
              className="absolute top-0 left-0 grid w-full"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                columnGap: COLUMN_GAP,
                transform: `translateY(${row.start - scrollMargin}px)`,
              }}
            >
              {albums.slice(row.index * columns, (row.index + 1) * columns).map((album) => (
                <AlbumTile key={album.id} album={album} playing={album.id === playingId} />
              ))}
            </div>
          ))}
      </div>
      <IndexRail
        entries={entries}
        onSelect={(index) => virtualizer.scrollToIndex(Math.floor(index / columns), { align: 'start' })}
      />
    </div>
  )
}
