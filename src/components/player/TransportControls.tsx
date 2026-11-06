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

interface TransportControlsProps {
  /** 전체 화면 재생용. 버튼이 크고 휴대폰에서도 모두 보인다. */
  large?: boolean
}

export function TransportControls({ large = false }: TransportControlsProps) {
  const hasTrack = usePlayer((state) => state.index >= 0)
  const isPlaying = usePlayer((state) => state.isPlaying)
  const shuffle = usePlayer((state) => state.shuffle)
  const repeat = usePlayer((state) => state.repeat)
  const canGoNext = usePlayer(
    (state) => state.index >= 0 && (state.index + 1 < state.queue.length || state.repeat === 'all'),
  )

  const compactOnly = large ? '' : 'hidden md:inline-flex'
  const icon = large ? 'size-6' : 'size-5'

  return (
    <div className={cn('flex items-center', large ? 'gap-4' : 'gap-2')}>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="셔플"
        aria-pressed={shuffle}
        onClick={toggleShuffle}
        className={cn(compactOnly, shuffle && 'text-point hover:text-point')}
      >
        <Shuffle className={icon} />
      </Button>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="이전 곡"
        disabled={!hasTrack}
        onClick={playPrevious}
        className={compactOnly}
      >
        <SkipBack className={icon} fill="currentColor" />
      </Button>
      <Button
        size="icon-lg"
        aria-label={isPlaying ? '일시정지' : '재생'}
        disabled={!hasTrack}
        onClick={togglePlay}
        className={cn('rounded-full', large && 'size-14')}
      >
        {isPlaying ? (
          <Pause className={large ? 'size-6' : 'size-4.5'} fill="currentColor" />
        ) : (
          <Play className={large ? 'size-6' : 'size-4.5'} fill="currentColor" />
        )}
      </Button>
      <Button variant="ghost" size="icon-lg" aria-label="다음 곡" disabled={!canGoNext} onClick={playNext}>
        <SkipForward className={icon} fill="currentColor" />
      </Button>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={REPEAT_LABELS[repeat]}
        aria-pressed={repeat !== 'off'}
        onClick={cycleRepeat}
        className={cn(compactOnly, repeat !== 'off' && 'text-point hover:text-point')}
      >
        {repeat === 'one' ? <Repeat1 className={icon} /> : <Repeat className={icon} />}
      </Button>
    </div>
  )
}
