import { AudioLines, ListPlus } from 'lucide-react'
import { memo } from 'react'
import { Button } from '@/components/ui/button'
import type { TrackFile } from '@/lib/folders/types'
import { trackDirectory, trackTitle } from '@/lib/tracks'
import { cn } from '@/lib/utils'
import { addToQueue, playList, usePlayer } from '@/stores/player-store'

interface TrackRowProps {
  tracks: TrackFile[]
  index: number
  current: boolean
}

const TrackRow = memo(function TrackRow({ tracks, index, current }: TrackRowProps) {
  const track = tracks[index]
  const title = trackTitle(track)
  const directory = trackDirectory(track)

  return (
    <li
      className={cn(
        'group flex h-11 items-center rounded-lg [contain-intrinsic-size:auto_44px] [content-visibility:auto]',
        current ? 'bg-point-soft' : 'hover:bg-raised/60',
      )}
    >
      <button
        type="button"
        onClick={(event) => {
          // 마우스로 누른 뒤 스페이스가 곡을 다시 시작하지 않고 재생/일시정지가 되도록 한다.
          if (event.detail > 0) event.currentTarget.blur()
          playList(tracks, index)
        }}
        className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-left"
      >
        <span className={cn('w-7 shrink-0 text-faint', current && 'text-point')}>
          {current ? <AudioLines aria-label="재생 중" className="size-4" /> : index + 1}
        </span>
        <span className="min-w-0">
          <span className={cn('block truncate', current && 'font-medium text-point')}>{title}</span>
          {directory && <span className="block truncate text-xs text-faint">{directory}</span>}
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`대기열에 추가: ${title}`}
        onClick={() => addToQueue(track)}
        className="mr-1 text-muted-foreground md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
      >
        <ListPlus />
      </Button>
    </li>
  )
})

interface TrackListProps {
  tracks: TrackFile[]
}

export function TrackList({ tracks }: TrackListProps) {
  const currentId = usePlayer((state) => state.queue[state.index]?.id)

  return (
    <ol className="mt-4">
      {tracks.map((track, index) => (
        <TrackRow key={track.id} tracks={tracks} index={index} current={track.id === currentId} />
      ))}
    </ol>
  )
}
