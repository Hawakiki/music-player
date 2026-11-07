import { type CSSProperties, type KeyboardEvent, type PointerEvent, useEffect, useId, useRef, useState } from 'react'
import { setVolume, usePlayer } from '@/stores/player-store'

/** 노브가 도는 범위. 실제 볼륨 노브처럼 7시에서 5시까지 270도다. */
const SWEEP_DEGREES = 270
const START_DEGREES = -SWEEP_DEGREES / 2
const TICK_COUNT = 11
/** 노브 중심에 너무 가까우면 손가락이 조금만 움직여도 각도가 크게 튄다. 이 안에서는 돌리지 않는다. */
const DEAD_ZONE_RATIO = 0.12
const MIN_DEAD_ZONE_PX = 6
const WHEEL_STEP = 0.02
const KEY_STEP = 0.01
const PAGE_STEP = 0.1

const TICKS = Array.from({ length: TICK_COUNT }, (_, index) => {
  const degrees = START_DEGREES + (SWEEP_DEGREES * index) / (TICK_COUNT - 1)
  const radians = (degrees * Math.PI) / 180
  const major = index === 0 || index === (TICK_COUNT - 1) / 2 || index === TICK_COUNT - 1
  const inner = 21
  const outer = major ? 26 : 24
  return {
    key: index,
    x1: Math.sin(radians) * inner,
    y1: -Math.cos(radians) * inner,
    x2: Math.sin(radians) * outer,
    y2: -Math.cos(radians) * outer,
    major,
  }
})

/** 손으로 잡는 옆면의 홈. 노브와 함께 돈다. */
const RIDGES = Array.from({ length: 36 }, (_, index) => (index * 360) / 36)

function clamp(value: number) {
  return Math.min(1, Math.max(0, value))
}

/** 잡은 노브. 중심은 누른 순간에 재고, 각도는 마지막으로 읽은 손의 방향이다. */
interface Grip {
  centerX: number
  centerY: number
  deadZone: number
  angle: number | null
  volume: number
}

/** 노브 중심에서 본 손의 방향. 12시가 0이고 시계 방향이 양수다. */
function getPointerAngle(grip: Grip, event: PointerEvent<HTMLDivElement>) {
  const dx = event.clientX - grip.centerX
  const dy = event.clientY - grip.centerY
  if (Math.hypot(dx, dy) < grip.deadZone) return null
  return (Math.atan2(dx, -dy) * 180) / Math.PI
}

interface LpVolumeKnobProps {
  /** 노브 상자의 위치와 크기. LP 화면 기준의 백분율이다. */
  style: CSSProperties
}

export function LpVolumeKnob({ style }: LpVolumeKnobProps) {
  const volume = usePlayer((player) => player.volume)
  const muted = usePlayer((player) => player.muted)
  const shown = muted ? 0 : volume
  const [dragging, setDragging] = useState(false)
  const grip = useRef<Grip | null>(null)
  const knob = useRef<HTMLDivElement>(null)
  const metal = useId()

  // React의 wheel은 수동 리스너라 막을 수 없다. 노브를 돌리는 동안 화면이 같이 스크롤되면 안 된다.
  useEffect(() => {
    const element = knob.current
    if (!element) return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const { volume: current, muted: silent } = usePlayer.getState()
      const step = event.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP
      setVolume(clamp((silent ? 0 : current) + step))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = event.currentTarget.getBoundingClientRect()
    const held: Grip = {
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      deadZone: Math.max(MIN_DEAD_ZONE_PX, rect.width * DEAD_ZONE_RATIO),
      angle: null,
      volume: shown,
    }
    held.angle = getPointerAngle(held, event)
    grip.current = held
    setDragging(true)
  }

  // 실제 노브처럼 손이 중심을 돈 각도만큼 돈다. 매번 움직인 만큼만 더해서, 끝에 닿은 뒤
  // 더 돌려도 멈춰 있다가 반대로 돌리면 바로 따라온다.
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const held = grip.current
    if (!held) return
    const angle = getPointerAngle(held, event)
    if (angle === null || held.angle === null) {
      held.angle = angle
      return
    }

    let turned = angle - held.angle
    if (turned > 180) turned -= 360
    if (turned < -180) turned += 360
    held.angle = angle
    held.volume = clamp(held.volume + turned / SWEEP_DEGREES)
    setVolume(held.volume)
  }

  const endDrag = () => {
    grip.current = null
    setDragging(false)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = {
      ArrowUp: KEY_STEP,
      ArrowRight: KEY_STEP,
      ArrowDown: -KEY_STEP,
      ArrowLeft: -KEY_STEP,
      PageUp: PAGE_STEP,
      PageDown: -PAGE_STEP,
    }
    let next: number | null = null
    if (event.key in steps) next = shown + steps[event.key]
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = 1
    if (next === null) return
    event.preventDefault()
    setVolume(clamp(Math.round(next * 100) / 100))
  }

  const percent = Math.round(shown * 100)
  const degrees = START_DEGREES + SWEEP_DEGREES * shown

  return (
    <div
      ref={knob}
      role="slider"
      tabIndex={0}
      aria-label="볼륨 노브"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent}%`}
      data-volume-knob
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className="group absolute cursor-grab touch-none rounded-full outline-none active:cursor-grabbing"
      style={style}
    >
      <svg viewBox="-36 -36 72 72" className="size-full overflow-visible" aria-hidden="true">
        <defs>
          <radialGradient id={metal} cx="0.38" cy="0.32" r="0.75">
            <stop offset="0" className="[stop-color:var(--knob-light)]" />
            <stop offset="1" className="[stop-color:var(--knob-face)]" />
          </radialGradient>
        </defs>
        {TICKS.map((tick) => (
          <line
            key={tick.key}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            strokeWidth={tick.major ? 1.4 : 0.9}
            strokeLinecap="round"
            className="stroke-faint"
          />
        ))}
        {/* LP 가장자리에 잘리지 않도록 포커스 테두리를 상자 안에 그린다. */}
        <circle
          r="29.5"
          fill="none"
          strokeWidth="1.5"
          className="stroke-point opacity-0 group-focus-visible:opacity-100"
        />
        <text y="33.5" textAnchor="middle" fontSize="5.6" letterSpacing="0.9" className="fill-faint font-semibold">
          VOLUME
        </text>
        {/* 노브가 판에서 떠 있도록 아래쪽으로 그림자를 둔다. */}
        <circle cy="1.6" r="17.2" className="fill-black/30" />
        <g
          data-knob-cap
          style={{ transform: `rotate(${degrees}deg)` }}
          className={dragging ? undefined : 'transition-transform duration-150 ease-out motion-reduce:transition-none'}
        >
          <circle r="16.4" className="fill-[var(--knob-skirt)]" />
          {RIDGES.map((angle) => (
            <line
              key={angle}
              x1="0"
              y1="-16.4"
              x2="0"
              y2="-13.6"
              strokeWidth="1"
              transform={`rotate(${angle})`}
              className="stroke-[var(--knob-ridge)]"
            />
          ))}
          <circle r="13" fill={`url(#${metal})`} />
          <circle r="13" fill="none" strokeWidth="0.6" className="stroke-[var(--knob-ridge)]" />
          <line y1="-5" y2="-11" strokeWidth="1.8" strokeLinecap="round" className="stroke-[var(--knob-mark)]" />
        </g>
      </svg>
    </div>
  )
}
