import { ListMusic, SlidersVertical } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { FavoriteButton } from '@/components/player/FavoriteButton'
import { SeekBar } from '@/components/player/SeekBar'
import { TrackArt } from '@/components/player/TrackArt'
import { TransportControls } from '@/components/player/TransportControls'
import { VolumeControl } from '@/components/player/VolumeControl'
import { buttonVariants } from '@/components/ui/button'
import { formatLabel } from '@/lib/metadata/format'
import { trackSubtitle, trackTitle } from '@/lib/tracks'
import { cn } from '@/lib/utils'
import { useEq } from '@/stores/eq-store'
import { useMetadata } from '@/stores/metadata-store'
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
  const meta = useMetadata((state) => (track ? state.items[track.id] : undefined))
  const eqEnabled = useEq((state) => state.enabled)
  const format = meta && formatLabel(meta)
  const { pathname } = useLocation()

  return (
    <section
      aria-label="플레이어"
      className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-t bg-panel px-4 py-2 md:h-21 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] md:py-0"
    >
      <div className="flex min-w-0 items-center gap-1">
        <Link
          to="/now-playing"
          state={{ from: pathname }}
          aria-label={track ? `전체 화면으로 보기: ${trackTitle(track, meta)}` : '전체 화면으로 보기'}
          className="flex min-w-0 items-center gap-3 rounded-md"
        >
          <TrackArt artId={meta?.artId} className="size-12 md:size-14" />
          {track ? (
            <span className="min-w-0">
              <span className="block truncate font-medium">{trackTitle(track, meta)}</span>
              <span className="block truncate text-caption text-muted-foreground">{trackSubtitle(track, meta)}</span>
            </span>
          ) : (
            <span className="truncate text-muted-foreground">재생 중인 곡 없음</span>
          )}
        </Link>
        {track && (
          <FavoriteButton track={track} label={trackTitle(track, meta)} className="ml-1 hidden shrink-0 md:inline-flex" />
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
        {format && <span className="mr-2 hidden truncate text-xs text-faint lg:block">{format}</span>}
        <Link
          to="/now-playing?tab=eq"
          state={{ from: pathname }}
          aria-label="이퀄라이저"
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'icon-lg' }),
            eqEnabled && 'text-point hover:text-point',
          )}
        >
          <SlidersVertical className="size-5" />
        </Link>
        <QueueLink className="xl:hidden" />
        <VolumeControl />
      </div>
    </section>
  )
}
