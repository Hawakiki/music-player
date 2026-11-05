import { X } from 'lucide-react'
import { TrackArt } from '@/components/player/TrackArt'
import { Button } from '@/components/ui/button'
import type { TrackFile } from '@/lib/folders/types'
import { trackDirectory, trackTitle } from '@/lib/tracks'
import { cn } from '@/lib/utils'
import { clearUpcoming, jumpTo, removeFromQueue, usePlayer } from '@/stores/player-store'

interface QueueRowProps {
  track: TrackFile
  current?: boolean
  onPlay?: () => void
  onRemove?: () => void
}

function QueueRow({ track, current = false, onPlay, onRemove }: QueueRowProps) {
  const title = trackTitle(track)
  const directory = trackDirectory(track)

  return (
    <li
      className={cn(
        'group flex h-14 items-center rounded-lg [contain-intrinsic-size:auto_56px] [content-visibility:auto]',
        current ? 'bg-point-soft' : 'hover:bg-raised/60',
      )}
    >
      <button
        type="button"
        disabled={!onPlay}
        onClick={onPlay}
        className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-lg px-2 text-left"
      >
        <TrackArt className="size-11" />
        <span className="min-w-0">
          <span className={cn('block truncate', current && 'font-medium text-point')}>{title}</span>
          {directory && <span className="block truncate text-xs text-faint">{directory}</span>}
        </span>
      </button>
      {onRemove && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`대기열에서 제거: ${title}`}
          onClick={onRemove}
          className="mr-1 text-muted-foreground md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
        >
          <X />
        </Button>
      )}
    </li>
  )
}

export function QueueList() {
  const queue = usePlayer((state) => state.queue)
  const index = usePlayer((state) => state.index)
  const current = queue[index]

  if (!current) {
    return <p className="px-1 text-muted-foreground">재생할 곡을 고르면 여기에 표시됩니다.</p>
  }

  const upcomingCount = queue.length - index - 1

  return (
    <>
      <ul>
        <QueueRow track={current} current />
      </ul>
      {upcomingCount > 0 && (
        <>
          <div className="flex items-center justify-between px-1 pt-3 pb-1">
            <h3 className="text-xs text-faint">다음 곡 {upcomingCount.toLocaleString('ko-KR')}개</h3>
            <button type="button" onClick={clearUpcoming} className="text-xs font-medium text-point">
              비우기
            </button>
          </div>
          <ul>
            {queue.slice(index + 1).map((track, offset) => {
              const position = index + 1 + offset
              return (
                <QueueRow
                  key={`${track.id}#${position}`}
                  track={track}
                  onPlay={() => jumpTo(position)}
                  onRemove={() => removeFromQueue(position)}
                />
              )
            })}
          </ul>
        </>
      )}
    </>
  )
}
