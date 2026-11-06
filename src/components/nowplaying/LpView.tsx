import { useRef } from 'react'
import { TrackArt } from '@/components/player/TrackArt'
import { useSpin } from '@/hooks/use-spin'
import { cn } from '@/lib/utils'
import { usePlayer } from '@/stores/player-store'
import { LP_RPM, useSound } from '@/stores/sound-store'

const VIEW_SIZE = 400
const DISC_X = 178
const DISC_Y = 205
const DISC_RADIUS = 170

/** 12인치 LP의 실제 치수(mm). */
const LP_RADIUS_MM = 150.8
const OUTER_GROOVE_MM = 146
const INNER_GROOVE_MM = 60
const LABEL_RADIUS_MM = 50
/** 곡이 없을 때 바늘이 쉬는 자리. 판 바깥이다. */
const ARM_REST_MM = 168

const UNITS_PER_MM = DISC_RADIUS / LP_RADIUS_MM
const GROOVE_COUNT = 12

const PIVOT_X = 372
const PIVOT_Y = 42
const ARM_LENGTH = 262
const PIVOT_DISTANCE = Math.hypot(PIVOT_X - DISC_X, PIVOT_Y - DISC_Y)
const DISC_DIRECTION = Math.atan2(DISC_Y - PIVOT_Y, DISC_X - PIVOT_X)

/** 재생과 일시정지 때 판이 속도를 바꾸는 빠르기. */
const SPIN_SECONDS = 0.28

function percent(units: number) {
  return `${(units / VIEW_SIZE) * 100}%`
}

/** 바늘이 판 위의 이 반지름에 닿도록 톤암을 돌릴 각도. 코사인 법칙으로 구한다. */
function getArmDegrees(radiusMm: number) {
  const radius = radiusMm * UNITS_PER_MM
  const cosine = (PIVOT_DISTANCE ** 2 + ARM_LENGTH ** 2 - radius ** 2) / (2 * PIVOT_DISTANCE * ARM_LENGTH)
  return ((DISC_DIRECTION - Math.acos(cosine)) * 180) / Math.PI
}

function Tonearm() {
  const progress = usePlayer((player) =>
    player.duration > 0 ? Math.min(player.position / player.duration, 1) : null,
  )
  // 홈의 간격이 일정해서 일정한 회전이면 반지름은 시간에 비례해 줄어든다.
  const radius =
    progress === null ? ARM_REST_MM : OUTER_GROOVE_MM - (OUTER_GROOVE_MM - INNER_GROOVE_MM) * progress

  return (
    <svg
      viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
      className="pointer-events-none absolute inset-0 size-full"
      aria-hidden="true"
    >
      <circle cx={PIVOT_X} cy={PIVOT_Y} r="15" className="fill-panel" />
      <g
        style={{
          transform: `rotate(${getArmDegrees(radius)}deg)`,
          transformOrigin: `${PIVOT_X}px ${PIVOT_Y}px`,
        }}
        className="transition-transform duration-500 ease-out motion-reduce:transition-none"
      >
        <line
          x1={PIVOT_X - 30}
          y1={PIVOT_Y}
          x2={PIVOT_X - 10}
          y2={PIVOT_Y}
          strokeWidth="9"
          strokeLinecap="round"
          className="stroke-tonearm"
        />
        <line
          x1={PIVOT_X}
          y1={PIVOT_Y}
          x2={PIVOT_X + ARM_LENGTH - 14}
          y2={PIVOT_Y}
          strokeWidth="3"
          strokeLinecap="round"
          className="stroke-tonearm"
        />
        <rect
          x={PIVOT_X + ARM_LENGTH - 20}
          y={PIVOT_Y - 4.5}
          width="20"
          height="9"
          rx="1.5"
          className="fill-tonearm"
        />
        <circle data-stylus cx={PIVOT_X + ARM_LENGTH} cy={PIVOT_Y} r="0.5" className="fill-tonearm" />
      </g>
      <circle cx={PIVOT_X} cy={PIVOT_Y} r="5" className="fill-tonearm" />
    </svg>
  )
}

const GROOVES = Array.from({ length: GROOVE_COUNT }, (_, index) => {
  const step = (OUTER_GROOVE_MM - INNER_GROOVE_MM) / (GROOVE_COUNT - 1)
  return (INNER_GROOVE_MM + step * index) * UNITS_PER_MM
})

interface LpViewProps {
  artId: string | undefined
  className: string
}

export function LpView({ artId, className }: LpViewProps) {
  const isPlaying = usePlayer((player) => player.isPlaying)
  const rpm = LP_RPM[useSound((state) => state.lpSpeed)]
  const disc = useRef<HTMLDivElement>(null)

  useSpin(disc, { turnsPerSecond: isPlaying ? rpm / 60 : 0, degrees: 360, settleSeconds: SPIN_SECONDS })

  return (
    <div role="img" aria-label="LP" className={cn('relative overflow-hidden rounded-lg bg-raised', className)}>
      <div
        ref={disc}
        data-disc
        className="absolute rounded-full bg-record"
        style={{
          left: percent(DISC_X - DISC_RADIUS),
          top: percent(DISC_Y - DISC_RADIUS),
          width: percent(DISC_RADIUS * 2),
          height: percent(DISC_RADIUS * 2),
        }}
      >
        <svg
          viewBox={`0 0 ${DISC_RADIUS * 2} ${DISC_RADIUS * 2}`}
          className="absolute inset-0 size-full"
          aria-hidden="true"
        >
          {GROOVES.map((radius) => (
            <circle
              key={radius}
              cx={DISC_RADIUS}
              cy={DISC_RADIUS}
              r={radius}
              fill="none"
              strokeWidth="0.75"
              className="stroke-groove"
            />
          ))}
        </svg>
        <TrackArt
          artId={artId}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-panel"
          style={{ width: `${(LABEL_RADIUS_MM / LP_RADIUS_MM) * 100}%`, aspectRatio: '1' }}
        />
        <span className="absolute top-1/2 left-1/2 size-[2.2%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-raised" />
      </div>
      <Tonearm />
    </div>
  )
}
