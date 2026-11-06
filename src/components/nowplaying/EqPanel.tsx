import { useState } from 'react'
import { EqSlider } from '@/components/nowplaying/EqSlider'
import { NameDialog } from '@/components/playlists/NameDialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { EQ_BANDS } from '@/lib/player/sound-graph'
import { cn } from '@/lib/utils'
import {
  BUILT_IN_PRESETS,
  deletePreset,
  resetEq,
  savePreset,
  selectPreset,
  setBandGain,
  setEqEnabled,
  setPreamp,
  useEq,
} from '@/stores/eq-store'
import { useSound } from '@/stores/sound-store'

const CUSTOM_VALUE = ''

function bandLabel(frequency: number) {
  return frequency >= 1000 ? `${frequency / 1000}k` : String(frequency)
}

export function EqPanel() {
  const enabled = useEq((state) => state.enabled)
  const preamp = useEq((state) => state.preamp)
  const gains = useEq((state) => state.gains)
  const presetId = useEq((state) => state.presetId)
  const customPresets = useEq((state) => state.customPresets)
  const direct = useSound((state) => state.direct)
  const [saving, setSaving] = useState(false)

  const isCustomPreset = customPresets.some((preset) => preset.id === presetId)

  return (
    <div className="flex h-full min-h-105 flex-col gap-3">
      <label className="flex items-center justify-between font-medium">
        이퀄라이저 사용
        <Switch
          checked={enabled}
          onCheckedChange={setEqEnabled}
          aria-label="이퀄라이저 사용"
          className="data-checked:bg-point"
        />
      </label>

      <select
        aria-label="프리셋"
        value={presetId ?? CUSTOM_VALUE}
        onChange={(event) => selectPreset(event.target.value)}
        className="h-9 w-full rounded-lg bg-raised px-3 outline-none"
      >
        {presetId === null && <option value={CUSTOM_VALUE}>직접 조정</option>}
        {[...BUILT_IN_PRESETS, ...customPresets].map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </select>

      <div className={cn('grid min-h-0 flex-1 grid-cols-[auto_1px_repeat(10,minmax(0,1fr))] gap-x-1 py-2', (!enabled || direct) && 'opacity-60')}>
        <EqSlider label="프리앰프" ariaLabel="프리앰프" value={preamp} onChange={setPreamp} />
        <div className="my-6 bg-border" />
        {EQ_BANDS.map((frequency, index) => (
          <EqSlider
            key={frequency}
            label={bandLabel(frequency)}
            ariaLabel={`${bandLabel(frequency)}Hz`}
            value={gains[index]}
            onChange={(value) => setBandGain(index, value)}
          />
        ))}
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" size="lg" className="flex-1" onClick={() => setSaving(true)}>
          저장
        </Button>
        <Button variant="secondary" size="lg" className="flex-1" onClick={resetEq}>
          초기화
        </Button>
        {isCustomPreset && presetId && (
          <Button variant="ghost" size="lg" className="px-3" onClick={() => deletePreset(presetId)}>
            프리셋 삭제
          </Button>
        )}
      </div>

      <NameDialog
        open={saving}
        title="프리셋 저장"
        confirmLabel="저장"
        onClose={() => setSaving(false)}
        onSubmit={(name) => {
          savePreset(name)
          setSaving(false)
        }}
      />
    </div>
  )
}
