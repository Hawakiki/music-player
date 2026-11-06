import { useMemo } from 'react'
import { Slider } from '@/components/ui/slider'
import { useSeek } from '@/hooks/use-seek'
import { useWaveform } from '@/hooks/use-waveform'
import type { TrackFile } from '@/lib/folders/types'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const BAR_WIDTH = 2
const BAR_STEP = 3
const MIN_BAR_HEIGHT = 4
const VIEW_HEIGHT = 100

function buildPath(peaks: Uint8Array) {
  let path = ''
  peaks.forEach((peak, index) => {
    const height = Math.max(MIN_BAR_HEIGHT, (peak / 255) * VIEW_HEIGHT)
    path += `M${index * BAR_STEP} ${(VIEW_HEIGHT - height) / 2}h${BAR_WIDTH}v${height}h-${BAR_WIDTH}z`
  })
  return path
}

interface WaveLayerProps {
  path: string
  width: number
  className: string
  clip?: string
}

function WaveLayer({ path, width, className, clip }: WaveLayerProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      className={cn('absolute inset-0 size-full', className)}
      style={clip ? { clipPath: clip } : undefined}
    >
      <path d={path} fill="currentColor" />
    </svg>
  )
}

interface WaveSeekProps {
  track: TrackFile | undefined
}

/** 파형을 그리고 그 위에 보이지 않는 슬라이더를 얹어서 키보드와 드래그를 그대로 쓴다. */
export function WaveSeek({ track }: WaveSeekProps) {
  const { shown, duration, onValueChange, onValueCommitted } = useSeek()
  const peaks = useWaveform(track)
  const path = useMemo(() => (peaks ? buildPath(peaks) : null), [peaks])
  const width = peaks ? peaks.length * BAR_STEP : 0
  const played = duration > 0 ? Math.min(shown / duration, 1) * 100 : 0

  return (
    <div>
      <div
        data-testid="wave"
        data-ready={path ? 'true' : 'false'}
        className="relative h-20 rounded-md has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
      >
        {path ? (
          <>
            <WaveLayer path={path} width={width} className="text-faint/40" />
            <WaveLayer path={path} width={width} className="text-point" clip={`inset(0 ${100 - played}% 0 0)`} />
          </>
        ) : (
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-raised">
            <div className="h-full rounded-full bg-point" style={{ width: `${played}%` }} />
          </div>
        )}
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
          className="absolute inset-0 opacity-0 [&>div]:h-full [&_[data-slot=slider-track]]:h-full"
        />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
        <span>{formatTime(shown)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  )
}
