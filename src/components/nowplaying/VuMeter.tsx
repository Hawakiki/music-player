import { useEffect, useRef } from 'react'
import { getMeterTap } from '@/lib/player/sound-graph'
import {
  VU_MARKS,
  createMeterBuffer,
  getNeedleTarget,
  isNeedleResting,
  moveNeedle,
  readChannel,
  vuToPosition,
  type Needle,
} from '@/lib/player/vu-meter'
import { cn } from '@/lib/utils'
import { usePlayer } from '@/stores/player-store'
import { useSound } from '@/stores/sound-store'

const WIDTH = 400
const HEIGHT = 196
const PIVOT_X = WIDTH / 2
const PIVOT_Y = 262
const SCALE_RADIUS = 214
const LABEL_RADIUS = 230
const SWEEP_DEGREES = 42

/** 음압이 큰 곡은 샘플 사이 피크가 0 dBFS를 늘 살짝 넘는다. 0을 기준으로 잡으면 계속 켜져 있어서 뜻이 없다. */
const OVER_PEAK = 10 ** (1 / 20)
const PEAK_HOLD_MS = 1200
const MAX_FRAME_SECONDS = 0.1

function getAngle(position: number) {
  return (position * 2 - 1) * SWEEP_DEGREES
}

function getPoint(position: number, radius: number) {
  const radians = (getAngle(position) * Math.PI) / 180
  return { x: PIVOT_X + radius * Math.sin(radians), y: PIVOT_Y - radius * Math.cos(radians) }
}

function getArc(from: number, to: number) {
  const start = getPoint(from, SCALE_RADIUS)
  const end = getPoint(to, SCALE_RADIUS)
  return `M ${start.x} ${start.y} A ${SCALE_RADIUS} ${SCALE_RADIUS} 0 0 1 ${end.x} ${end.y}`
}

function formatMark(vu: number) {
  return vu > 0 ? `+${vu}` : String(vu)
}

interface MeterFaceProps {
  label: string
  needleRef: React.RefObject<SVGLineElement | null>
  peakRef: React.RefObject<SVGCircleElement | null>
}

function MeterFace({ label, needleRef, peakRef }: MeterFaceProps) {
  const zero = vuToPosition(0)

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="size-full min-h-0 rounded-lg bg-raised" aria-hidden="true">
      <path d={getArc(0, zero)} fill="none" strokeWidth="1.5" className="stroke-muted-foreground" />
      <path d={getArc(zero, 1)} fill="none" strokeWidth="4" className="stroke-destructive" />
      {VU_MARKS.map((vu) => {
        const position = vuToPosition(vu)
        const inner = getPoint(position, SCALE_RADIUS - 9)
        const outer = getPoint(position, SCALE_RADIUS)
        const text = getPoint(position, LABEL_RADIUS)
        return (
          <g key={vu}>
            <line
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              strokeWidth="1.5"
              className={vu > 0 ? 'stroke-destructive' : 'stroke-muted-foreground'}
            />
            <text
              x={text.x}
              y={text.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="14"
              className={vu > 0 ? 'fill-destructive' : 'fill-muted-foreground'}
            >
              {formatMark(vu)}
            </text>
          </g>
        )
      })}
      <text x="20" y={HEIGHT - 18} fontSize="15" className="fill-muted-foreground">
        {label}
      </text>
      <text x="42" y={HEIGHT - 18} fontSize="15" className="fill-faint">
        VU
      </text>
      <text x={WIDTH - 36} y={HEIGHT - 18} textAnchor="end" fontSize="13" className="fill-muted-foreground">
        피크
      </text>
      <circle ref={peakRef} data-peak cx={WIDTH - 22} cy={HEIGHT - 23} r="6" className="fill-faint/30" />
      <line
        ref={needleRef}
        data-needle
        x1={PIVOT_X}
        y1={PIVOT_Y}
        x2={PIVOT_X}
        y2={PIVOT_Y - SCALE_RADIUS + 4}
        strokeWidth="2"
        strokeLinecap="round"
        transform={`rotate(${getAngle(0)} ${PIVOT_X} ${PIVOT_Y})`}
        className="stroke-foreground"
      />
    </svg>
  )
}

interface VuMeterProps {
  className: string
}

export function VuMeter({ className }: VuMeterProps) {
  const isPlaying = usePlayer((player) => player.isPlaying)
  const reference = Number(useSound((state) => state.vuReference))

  const leftNeedle = useRef<SVGLineElement>(null)
  const rightNeedle = useRef<SVGLineElement>(null)
  const leftPeak = useRef<SVGCircleElement>(null)
  const rightPeak = useRef<SVGCircleElement>(null)
  const needles = useRef<{ left: Needle; right: Needle }>({
    left: { position: 0, velocity: 0 },
    right: { position: 0, velocity: 0 },
  })
  const peakUntil = useRef({ left: 0, right: 0 })
  const lastFrame = useRef(0)
  const animation = useRef(0)

  useEffect(() => {
    const samples = createMeterBuffer()
    lastFrame.current = performance.now()

    const drawChannel = (
      side: 'left' | 'right',
      needleLine: SVGLineElement | null,
      peakLight: SVGCircleElement | null,
      analyser: AnalyserNode | undefined,
      now: number,
      seconds: number,
    ) => {
      const { average, peak } = analyser ? readChannel(analyser, samples) : { average: 0, peak: 0 }
      moveNeedle(needles.current[side], getNeedleTarget(average, reference), seconds)
      needleLine?.setAttribute(
        'transform',
        `rotate(${getAngle(needles.current[side].position)} ${PIVOT_X} ${PIVOT_Y})`,
      )

      if (peak >= OVER_PEAK) peakUntil.current[side] = now + PEAK_HOLD_MS
      const over = now < peakUntil.current[side]
      peakLight?.classList.toggle('fill-destructive', over)
      peakLight?.classList.toggle('fill-faint/30', !over)
    }

    const draw = (now: number) => {
      const seconds = Math.min((now - lastFrame.current) / 1000, MAX_FRAME_SECONDS)
      lastFrame.current = now

      const tap = getMeterTap()
      drawChannel('left', leftNeedle.current, leftPeak.current, tap?.left, now, seconds)
      drawChannel('right', rightNeedle.current, rightPeak.current, tap?.right, now, seconds)

      // 멈춘 뒤 바늘이 내려앉으면 그리기를 쉰다.
      const resting = isNeedleResting(needles.current.left) && isNeedleResting(needles.current.right)
      const peaking = now < Math.max(peakUntil.current.left, peakUntil.current.right)
      if (isPlaying || !resting || peaking) animation.current = requestAnimationFrame(draw)
    }

    animation.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animation.current)
  }, [isPlaying, reference])

  return (
    <div role="img" aria-label="VU 미터" className={cn('grid grid-rows-2 gap-2', className)}>
      <MeterFace label="L" needleRef={leftNeedle} peakRef={leftPeak} />
      <MeterFace label="R" needleRef={rightNeedle} peakRef={rightPeak} />
    </div>
  )
}
