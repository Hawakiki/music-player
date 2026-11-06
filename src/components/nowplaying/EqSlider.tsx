import { Slider as SliderPrimitive } from '@base-ui/react/slider'
import { EQ_RANGE } from '@/lib/player/sound-graph'

function formatGain(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`
}

interface EqSliderProps {
  label: string
  ariaLabel: string
  value: number
  onChange: (value: number) => void
}

/** 0을 가운데 둔 세로 슬라이더. 기본 슬라이더는 맨 아래부터 채워져서 따로 만든다. */
export function EqSlider({ label, ariaLabel, value, onChange }: EqSliderProps) {
  const percent = ((value + EQ_RANGE) / (EQ_RANGE * 2)) * 100

  return (
    <div className="flex h-full min-w-0 flex-col items-center gap-1.5 text-xs text-faint">
      <span className="text-muted-foreground">{formatGain(value)}</span>
      <SliderPrimitive.Root
        orientation="vertical"
        value={[value]}
        min={-EQ_RANGE}
        max={EQ_RANGE}
        step={0.5}
        onValueChange={(next) => onChange(typeof next === 'number' ? next : next[0])}
        className="min-h-0 flex-1"
      >
        <SliderPrimitive.Control className="relative flex h-full w-6 touch-none justify-center select-none">
          <SliderPrimitive.Track className="relative h-full w-1 rounded-full bg-raised">
            <span className="absolute top-1/2 -right-1.5 -left-1.5 h-px bg-border" />
            <span
              className="absolute inset-x-0 bg-point"
              style={{ bottom: `${Math.min(percent, 50)}%`, height: `${Math.abs(percent - 50)}%` }}
            />
            <SliderPrimitive.Thumb
              aria-label={ariaLabel}
              getAriaValueText={(_, thumbValue) => `${formatGain(thumbValue)} dB`}
              className="h-2.5 w-5 rounded-sm bg-primary outline-none has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            />
          </SliderPrimitive.Track>
        </SliderPrimitive.Control>
      </SliderPrimitive.Root>
      <span className="whitespace-nowrap">{label}</span>
    </div>
  )
}
