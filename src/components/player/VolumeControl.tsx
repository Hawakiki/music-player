import { Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { setVolume, toggleMute, usePlayer } from '@/stores/player-store'

export function VolumeControl() {
  const volume = usePlayer((state) => state.volume)
  const muted = usePlayer((state) => state.muted)
  const shown = muted ? 0 : Math.round(volume * 100)

  return (
    <div className="flex w-36 items-center gap-1">
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={muted ? '음소거 해제' : '음소거'}
        aria-pressed={muted}
        onClick={toggleMute}
      >
        {muted ? <VolumeX className="size-4.5" /> : <Volume2 className="size-4.5" />}
      </Button>
      <Slider
        value={[shown]}
        min={0}
        max={100}
        step={1}
        thumbLabel="볼륨"
        thumbValueText={(value) => `${value}%`}
        onValueChange={(value) => setVolume((typeof value === 'number' ? value : value[0]) / 100)}
        className="[&_[data-slot=slider-range]]:bg-muted-foreground"
      />
    </div>
  )
}
