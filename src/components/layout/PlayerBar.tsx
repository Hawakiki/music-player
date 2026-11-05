import { ListMusic, SlidersVertical } from 'lucide-react'
import { Link } from 'react-router-dom'
import { SeekBar } from '@/components/player/SeekBar'
import { TrackArt } from '@/components/player/TrackArt'
import { TransportControls } from '@/components/player/TransportControls'
import { VolumeControl } from '@/components/player/VolumeControl'
import { Button, buttonVariants } from '@/components/ui/button'
import { trackDirectory, trackTitle } from '@/lib/tracks'
import { usePlayer } from '@/stores/player-store'

interface QueueLinkProps {
  className: string
}

function QueueLink({ className }: QueueLinkProps) {
  return (
    <Link to="/queue" aria-label="대기열" className={buttonVariants({ variant: 'ghost', size: 'icon-lg', className })}>
      <ListMusic className="size-5" />
    </Link>
  )
}

export function PlayerBar() {
  const track = usePlayer((state) => state.queue[state.index])

  return (
    <section
      aria-label="플레이어"
      className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-t bg-panel px-4 py-2 md:h-21 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] md:py-0"
    >
      <div className="flex min-w-0 items-center gap-3">
        <TrackArt className="size-12 md:size-14" />
        {track ? (
          <div className="min-w-0">
            <p className="truncate font-medium">{trackTitle(track)}</p>
            <p className="truncate text-caption text-muted-foreground">{trackDirectory(track)}</p>
          </div>
        ) : (
          <p className="truncate text-muted-foreground">재생 중인 곡 없음</p>
        )}
      </div>

      <div className="contents md:flex md:flex-col md:items-center md:gap-1">
        <div className="flex items-center gap-2">
          <TransportControls />
          <QueueLink className="md:hidden" />
        </div>
        <SeekBar className="col-span-2 md:max-w-155" />
      </div>

      <div className="hidden items-center justify-end gap-1 md:flex">
        <Button variant="ghost" size="icon-lg" disabled aria-label="이퀄라이저">
          <SlidersVertical className="size-5" />
        </Button>
        <QueueLink className="xl:hidden" />
        <VolumeControl />
      </div>
    </section>
  )
}
