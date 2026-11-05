import { Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RepeatMode } from '@/lib/player/session'
import { cn } from '@/lib/utils'
import {
  cycleRepeat,
  playNext,
  playPrevious,
  togglePlay,
  toggleShuffle,
  usePlayer,
} from '@/stores/player-store'

const REPEAT_LABELS: Record<RepeatMode, string> = {
  off: '반복 끔',
  all: '전체 반복',
  one: '한 곡 반복',
}

export function TransportControls() {
  const hasTrack = usePlayer((state) => state.index >= 0)
  const isPlaying = usePlayer((state) => state.isPlaying)
  const shuffle = usePlayer((state) => state.shuffle)
  const repeat = usePlayer((state) => state.repeat)
  const canGoNext = usePlayer(
    (state) => state.index >= 0 && (state.index + 1 < state.queue.length || state.repeat === 'all'),
  )

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="셔플"
        aria-pressed={shuffle}
        onClick={toggleShuffle}
        className={cn('hidden md:inline-flex', shuffle && 'text-point hover:text-point')}
      >
        <Shuffle className="size-5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="이전 곡"
        disabled={!hasTrack}
        onClick={playPrevious}
        className="hidden md:inline-flex"
      >
        <SkipBack className="size-5" fill="currentColor" />
      </Button>
      <Button
        size="icon-lg"
        aria-label={isPlaying ? '일시정지' : '재생'}
        disabled={!hasTrack}
        onClick={togglePlay}
        className="rounded-full"
      >
        {isPlaying ? (
          <Pause className="size-4.5" fill="currentColor" />
        ) : (
          <Play className="size-4.5" fill="currentColor" />
        )}
      </Button>
      <Button variant="ghost" size="icon-lg" aria-label="다음 곡" disabled={!canGoNext} onClick={playNext}>
        <SkipForward className="size-5" fill="currentColor" />
      </Button>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={REPEAT_LABELS[repeat]}
        aria-pressed={repeat !== 'off'}
        onClick={cycleRepeat}
        className={cn('hidden md:inline-flex', repeat !== 'off' && 'text-point hover:text-point')}
      >
        {repeat === 'one' ? <Repeat1 className="size-5" /> : <Repeat className="size-5" />}
      </Button>
    </div>
  )
}
