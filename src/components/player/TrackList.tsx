import { useVirtualizer } from '@tanstack/react-virtual'
import { AudioLines } from 'lucide-react'
import { useMemo, useRef, useState, type DragEvent } from 'react'
import { useMainScroll, useScrollMargin } from '@/components/layout/main-scroll'
import { FavoriteButton } from '@/components/player/FavoriteButton'
import { TrackArt } from '@/components/player/TrackArt'
import { TrackMenu } from '@/components/player/TrackMenu'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import type { TrackFile } from '@/lib/folders/types'
import { formatTime } from '@/lib/format'
import type { TrackMeta } from '@/lib/metadata/types'
import { trackSubtitle, trackTitle } from '@/lib/tracks'
import { cn } from '@/lib/utils'
import { useMetadata } from '@/stores/metadata-store'
import { playList, usePlayer } from '@/stores/player-store'

const TRACK_ROW_HEIGHT = 44
const LIST_ROW_HEIGHT = 56
const DISC_ROW_HEIGHT = 36

const HOVER_ONLY =
  'md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100 md:data-[popup-open]:opacity-100'

type Row = { kind: 'disc'; key: string; disc: number } | { kind: 'track'; key: string; index: number }

function buildRows(tracks: TrackFile[], items: Record<string, TrackMeta>, showDiscs: boolean) {
  const discs = new Set(tracks.map((track) => items[track.id]?.discNo ?? 1))
  const rows: Row[] = []
  let currentDisc: number | null = null

  tracks.forEach((track, index) => {
    const disc = items[track.id]?.discNo ?? 1
    if (showDiscs && discs.size > 1 && disc !== currentDisc) {
      rows.push({ kind: 'disc', key: `disc-${disc}`, disc })
      currentDisc = disc
    }
    rows.push({ kind: 'track', key: `${track.id}#${index}`, index })
  })

  return rows
}

export interface TrackListEditing {
  /** `before` 위치 앞으로 옮긴다. */
  onMove: (from: number, before: number) => void
  onRemove: (index: number) => void
}

interface TrackRowProps {
  tracks: TrackFile[]
  index: number
  album: boolean
  editing?: TrackListEditing
}

function TrackRow({ tracks, index, album, editing }: TrackRowProps) {
  const track = tracks[index]
  const meta = useMetadata((state) => state.items[track.id])
  const current = usePlayer((state) => state.queue[state.index]?.id === track.id)
  const title = trackTitle(track, meta)
  const subtitle = trackSubtitle(track, meta)

  return (
    <div className={cn('group flex h-full items-center rounded-lg', current ? 'bg-point-soft' : 'hover:bg-raised/60')}>
      <button
        type="button"
        onClick={(event) => {
          // 마우스로 누른 뒤 스페이스가 곡을 다시 시작하지 않고 재생/일시정지가 되도록 한다.
          if (event.detail > 0) event.currentTarget.blur()
          playList(tracks, index)
        }}
        className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-left"
      >
        {album ? (
          <span className={cn('w-7 shrink-0 text-faint', current && 'text-point')}>
            {current ? <AudioLines aria-label="재생 중" className="size-4" /> : (meta?.trackNo ?? index + 1)}
          </span>
        ) : (
          <TrackArt artId={meta?.artId} className="size-10" />
        )}
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate', current && 'font-medium text-point')}>{title}</span>
          {!album && subtitle && <span className="block truncate text-xs text-faint">{subtitle}</span>}
        </span>
        {album ? (
          <span className="hidden w-1/4 shrink-0 truncate text-muted-foreground sm:block">{meta?.artist}</span>
        ) : (
          <span className="hidden w-1/3 shrink-0 truncate text-muted-foreground lg:block">{meta?.album}</span>
        )}
        {!album && current && <AudioLines aria-label="재생 중" className="size-4 shrink-0 text-point" />}
      </button>
      <FavoriteButton track={track} label={title} className={HOVER_ONLY} />
      <TrackMenu tracks={[track]} label={title} className={HOVER_ONLY}>
        {editing && (
          <>
            <DropdownMenuItem disabled={index === 0} onClick={() => editing.onMove(index, index - 1)}>
              위로 이동
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index === tracks.length - 1}
              onClick={() => editing.onMove(index, index + 2)}
            >
              아래로 이동
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editing.onRemove(index)}>재생목록에서 제거</DropdownMenuItem>
          </>
        )}
      </TrackMenu>
      <span className="w-12 shrink-0 pr-3 text-right text-muted-foreground">
        {meta?.duration ? formatTime(meta.duration) : ''}
      </span>
    </div>
  )
}

interface TrackListProps {
  tracks: TrackFile[]
  /** 앨범 화면: 트랙 번호와 디스크 구분을 보여 준다. */
  album?: boolean
  /** 재생목록 화면: 끌어서 순서를 바꾸고 곡을 뺄 수 있다. */
  editing?: TrackListEditing
}

export function TrackList({ tracks, album = false, editing }: TrackListProps) {
  const main = useMainScroll()
  const listRef = useRef<HTMLOListElement>(null)
  const scrollMargin = useScrollMargin(listRef)
  const items = useMetadata((state) => state.items)
  const rows = useMemo(() => buildRows(tracks, items, album), [tracks, items, album])
  const rowHeight = album ? TRACK_ROW_HEIGHT : LIST_ROW_HEIGHT

  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropBefore, setDropBefore] = useState<number | null>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => main,
    estimateSize: (index) => (rows[index].kind === 'disc' ? DISC_ROW_HEIGHT : rowHeight),
    getItemKey: (index) => rows[index].key,
    overscan: 10,
    scrollMargin,
  })

  function trackDragOver(event: DragEvent<HTMLLIElement>, index: number) {
    if (dragFrom === null) return

    event.preventDefault()
    const { top, height } = event.currentTarget.getBoundingClientRect()
    setDropBefore(event.clientY > top + height / 2 ? index + 1 : index)
  }

  function finishDrag() {
    if (dragFrom !== null && dropBefore !== null && dropBefore !== dragFrom && dropBefore !== dragFrom + 1) {
      editing?.onMove(dragFrom, dropBefore)
    }
    setDragFrom(null)
    setDropBefore(null)
  }

  return (
    <ol ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index]
        const index = row.kind === 'track' ? row.index : -1

        return (
          <li
            key={item.key}
            draggable={Boolean(editing) && row.kind === 'track'}
            onDragStart={() => setDragFrom(index)}
            onDragOver={(event) => trackDragOver(event, index)}
            onDrop={(event) => {
              event.preventDefault()
              finishDrag()
            }}
            onDragEnd={() => {
              setDragFrom(null)
              setDropBefore(null)
            }}
            className={cn(
              'absolute top-0 left-0 w-full',
              dropBefore === index && 'border-t-2 border-point',
              dropBefore === tracks.length && index === tracks.length - 1 && 'border-b-2 border-point',
            )}
            style={{ height: item.size, transform: `translateY(${item.start - scrollMargin}px)` }}
          >
            {row.kind === 'disc' ? (
              <p className="flex h-full items-end px-3 pb-1 text-xs text-faint">디스크 {row.disc}</p>
            ) : (
              <TrackRow tracks={tracks} index={row.index} album={album} editing={editing} />
            )}
          </li>
        )
      })}
    </ol>
  )
}
