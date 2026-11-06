import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { TONE_RANGE, type CrossfeedLevel, type PhaseLevel, type VinylLevel } from '@/lib/player/sound-graph'
import type { TubeMode } from '@/lib/player/tube-stage'
import { cn } from '@/lib/utils'
import { resetSound, setSound, useSound } from '@/stores/sound-store'

const CROSSFEED_OPTIONS: { value: CrossfeedLevel; label: string }[] = [
  { value: 'off', label: '끔' },
  { value: 'light', label: '약' },
  { value: 'medium', label: '중' },
  { value: 'strong', label: '강' },
]

const TUBE_MODE_OPTIONS: { value: TubeMode; label: string }[] = [
  { value: 'triode', label: '트라이오드' },
  { value: 'ultralinear', label: '울트라리니어' },
]

const TUBE_MODE_HINTS: Record<TubeMode, string> = {
  triode: '부드럽고 풍성한 소리',
  ultralinear: '또렷하고 단단한 소리',
}

const VINYL_OPTIONS = CROSSFEED_OPTIONS as { value: VinylLevel; label: string }[]
const PHASE_OPTIONS = CROSSFEED_OPTIONS as { value: PhaseLevel; label: string }[]

function formatDb(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`
}

function formatBalance(value: number) {
  if (value === 0) return '가운데'
  return `${value < 0 ? '왼쪽' : '오른쪽'} ${Math.round(Math.abs(value) * 100)}`
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function formatTube(value: number) {
  return value === 0 ? '끔' : formatPercent(value)
}

interface SoundSliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  onChange: (value: number) => void
  disabled?: boolean
  /** 왼쪽 끝이 기준인 값. 기본은 가운데가 기준이다. */
  fromStart?: boolean
}

/** 가운데가 기준인 값은 기본 슬라이더 대신 가운데에서 양쪽으로 채운다. */
function SoundSlider({ label, value, min, max, step, format, onChange, disabled, fromStart = false }: SoundSliderProps) {
  const percent = ((value - min) / (max - min)) * 100
  const origin = fromStart ? 0 : 50

  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-3">
      <span>{label}</span>
      <div className="relative flex items-center">
        <div className="absolute inset-x-0 h-1 rounded-full bg-raised">
          {!fromStart && <div className="absolute top-1/2 left-1/2 h-2.5 w-px -translate-y-1/2 bg-faint" />}
          <div
            className="absolute inset-y-0 rounded-full bg-point"
            style={{ left: `${Math.min(percent, origin)}%`, width: `${Math.abs(percent - origin)}%` }}
          />
        </div>
        <Slider
          value={[value]}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          thumbLabel={label}
          thumbValueText={format}
          onValueChange={(next) => onChange(typeof next === 'number' ? next : next[0])}
          className="relative [&_[data-slot=slider-range]]:bg-transparent [&_[data-slot=slider-track]]:bg-transparent"
        />
      </div>
      <span className="text-right text-caption text-muted-foreground">{format(value)}</span>
    </div>
  )
}

interface SoundSectionProps {
  title: string
  children: ReactNode
}

function SoundSection({ title, children }: SoundSectionProps) {
  return (
    <section className="border-t pt-3">
      <h3 className="pb-3 text-xs text-faint">{title}</h3>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  )
}

export function SoundPanel() {
  const { bass, treble, balance, width, mono, crossfeed, tube, tubeMode, vinyl, phase, direct } = useSound()

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center justify-between gap-4">
        <span>
          <span className="block font-medium">원음 듣기</span>
          <span className="block text-caption text-muted-foreground">이퀄라이저와 효과를 잠시 끄고 비교합니다.</span>
        </span>
        <Switch
          aria-label="원음 듣기"
          checked={direct}
          onCheckedChange={(next) => setSound({ direct: next })}
          className="data-checked:bg-point"
        />
      </label>

      <div className={cn('flex flex-col gap-4', direct && 'opacity-60')}>
        <SoundSection title="소리 조절">
          <SoundSlider
            label="저음"
            value={bass}
            min={-TONE_RANGE}
            max={TONE_RANGE}
            step={0.5}
            format={formatDb}
            onChange={(next) => setSound({ bass: next })}
          />
          <SoundSlider
            label="고음"
            value={treble}
            min={-TONE_RANGE}
            max={TONE_RANGE}
            step={0.5}
            format={formatDb}
            onChange={(next) => setSound({ treble: next })}
          />
          <SoundSlider
            label="밸런스"
            value={balance}
            min={-1}
            max={1}
            step={0.01}
            format={formatBalance}
            onChange={(next) => setSound({ balance: next })}
          />
          <SoundSlider
            label="스테레오 폭"
            value={width}
            min={0}
            max={2}
            step={0.05}
            format={formatPercent}
            disabled={mono}
            onChange={(next) => setSound({ width: next })}
          />
          <label className="flex items-center justify-between">
            모노
            <Switch
              aria-label="모노"
              checked={mono}
              onCheckedChange={(next) => setSound({ mono: next })}
              className="data-checked:bg-point"
            />
          </label>
        </SoundSection>

        <SoundSection title="헤드폰">
          <div className="flex items-center justify-between gap-3">
            <span>
              <span className="block">크로스피드</span>
              <span className="block text-caption text-muted-foreground">좌우가 심하게 갈린 녹음을 편하게</span>
            </span>
            <SegmentedControl
              name="crossfeed"
              options={CROSSFEED_OPTIONS}
              value={crossfeed}
              onChange={(next) => setSound({ crossfeed: next })}
            />
          </div>
        </SoundSection>

        <SoundSection title="효과">
          <SoundSlider
            label="진공관"
            value={tube}
            min={0}
            max={1}
            step={0.05}
            format={formatTube}
            fromStart
            onChange={(next) => setSound({ tube: next })}
          />
          <div className="flex items-center justify-between gap-3">
            <span>
              <span className="block">앰프 모드</span>
              <span className="block text-caption text-muted-foreground">{TUBE_MODE_HINTS[tubeMode]}</span>
            </span>
            <SegmentedControl
              name="tube-mode"
              options={TUBE_MODE_OPTIONS}
              value={tubeMode}
              disabled={tube === 0}
              onChange={(next) => setSound({ tubeMode: next })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>
              <span className="block">바이닐</span>
              <span className="block text-caption text-muted-foreground">표면 잡음과 미세한 회전 흔들림</span>
            </span>
            <SegmentedControl
              name="vinyl"
              options={VINYL_OPTIONS}
              value={vinyl}
              onChange={(next) => setSound({ vinyl: next })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>
              <span className="block">저역 위상 보정</span>
              <span className="block text-caption text-muted-foreground">음량은 두고 저역 위상만 돌림</span>
            </span>
            <SegmentedControl
              name="phase"
              options={PHASE_OPTIONS}
              value={phase}
              onChange={(next) => setSound({ phase: next })}
            />
          </div>
        </SoundSection>
      </div>

      <Button variant="secondary" size="lg" onClick={resetSound}>
        초기화
      </Button>
    </div>
  )
}
