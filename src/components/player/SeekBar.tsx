import { Slider } from '@/components/ui/slider'
import { useSeek } from '@/hooks/use-seek'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'

interface SeekBarProps {
  className?: string
}

export function SeekBar({ className }: SeekBarProps) {
  const { shown, duration, onValueChange, onValueCommitted } = useSeek()

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
        onValueChange={onValueChange}
        onValueCommitted={onValueCommitted}
        className="[&_[data-slot=slider-range]]:bg-point"
      />
      <span className="w-9 shrink-0">{formatTime(duration)}</span>
    </div>
  )
}
