import { useState } from 'react'
import { Slider } from '@/components/ui/slider'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { seek, usePlayer } from '@/stores/player-store'

function firstValue(value: number | readonly number[]) {
  return typeof value === 'number' ? value : value[0]
}

interface SeekBarProps {
  className?: string
}

export function SeekBar({ className }: SeekBarProps) {
  const position = usePlayer((state) => state.position)
  const duration = usePlayer((state) => state.duration)
  // 끄는 동안에는 재생 위치 대신 손가락이 있는 위치를 보여 준다.
  const [dragging, setDragging] = useState<number | null>(null)
  const shown = dragging ?? position

  return (
    <div className={cn('flex w-full items-center gap-2.5 text-xs text-muted-foreground', className)}>
      <span className="w-9 shrink-0 text-right">{formatTime(shown)}</span>
      <Slider
        value={[Math.min(shown, duration)]}
        min={0}
        max={duration || 1}
        step={1}
        disabled={duration === 0}
        thumbLabel="재생 위치"
        thumbValueText={formatTime}
        onValueChange={(value) => setDragging(firstValue(value))}
        onValueCommitted={(value) => {
          seek(firstValue(value))
          setDragging(null)
        }}
        className="[&_[data-slot=slider-range]]:bg-point"
      />
      <span className="w-9 shrink-0">{formatTime(duration)}</span>
    </div>
  )
}
