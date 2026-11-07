import { useVirtualizer } from '@tanstack/react-virtual'
import { AudioLines, Pause, Play } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { IndexRail } from '@/components/library/IndexRail'
import { useElementWidth, useMainScroll, useScrollMargin } from '@/components/layout/main-scroll'
import { TrackArt } from '@/components/player/TrackArt'
import { useLibraryIndex } from '@/hooks/use-library-index'
import type { Album } from '@/lib/library/build'
import { buildIndex } from '@/lib/library/initials'
import { cn } from '@/lib/utils'
import { playList, togglePlay, usePlayer } from '@/stores/player-store'

const MIN_TILE_WIDTH = 160
const COLUMN_GAP = 20
const ROW_GAP = 24
const TEXT_HEIGHT = 52

interface AlbumTileProps {
  album: Album
  playing: boolean
}

function AlbumTile({ album, playing }: AlbumTileProps) {
  const sounding = usePlayer((state) => playing && state.isPlaying)

  return (
    <div className="group relative min-w-0">
      <Link to={`/albums/${album.id}`} className="block rounded-md">
        <TrackArt artId={album.artId} className="aspect-square w-full" />
        <p className={cn('mt-2 truncate font-medium', playing && 'text-point')}>{album.title}</p>
        <p className="truncate text-caption text-faint">{album.artist}</p>
      </Link>
      {/* 버튼은 링크 안에 둘 수 없어서 표지 크기의 층을 겹친다. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 aspect-square">
        {playing && (
          <span className="absolute right-2 bottom-2 grid size-7 place-items-center rounded-md bg-panel text-point transition-opacity group-hover:opacity-0 group-has-[button:focus-visible]:opacity-0">
            <AudioLines aria-label="재생 중" className="size-4" />
          </span>
        )}
        {/* 마우스가 없으면 안 보이는 버튼이 표지 탭을 가로채므로 아예 뺀다. */}
        <button
          type="button"
          aria-label={sounding ? `${album.title} 일시정지` : `${album.title} 재생`}
          onClick={() => (playing ? togglePlay() : playList(album.tracks))}
          className="pointer-events-auto absolute right-2 bottom-2 hidden size-10 translate-y-1 place-items-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-md shadow-black/25 transition group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100 motion-reduce:transition-none [@media(hover:hover)]:grid"
        >
          {sounding ? <Pause fill="currentColor" className="size-4" /> : <Play fill="currentColor" className="ml-0.5 size-4" />}
        </button>
      </div>
    </div>
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
