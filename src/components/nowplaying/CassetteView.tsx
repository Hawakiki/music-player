import { useId, useRef, type ReactNode } from 'react'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useSpin } from '@/hooks/use-spin'
import { formatTime } from '@/lib/format'
import { formatLabel, isUnusualFormat } from '@/lib/metadata/format'
import type { TrackMeta } from '@/lib/metadata/types'
import { cn } from '@/lib/utils'
import { usePlayer } from '@/stores/player-store'

/** 컴팩트 카세트의 실제 치수(mm). 테이프는 초당 47.6mm로 일정하게 간다. */
const TAPE_SPEED_MM = 47.6
const HUB_RADIUS_MM = 11
const FULL_RADIUS_MM = 25
const UNITS_PER_MM = 10

const WIDTH = 1004
const HEIGHT = 638
const LABEL = { x: 58, y: 36, width: 888, height: 428 }
const STICKER = { x: 78, y: 54, width: 848, height: 166 }
const TAPE_WINDOW = { x: 372, y: 288, width: 260, height: 100 }
const REELS = [
  { x: 289.5, y: 338 },
  { x: 714.5, y: 338 },
]
const HOLE_RADIUS = 62
const HUB_SIZE = 108
const HUB_TEETH = [0, 60, 120, 180, 240, 300]
const SCREWS = [
  { x: 30, y: 30, turn: 20 },
  { x: 974, y: 30, turn: 65 },
  { x: 30, y: 608, turn: 110 },
  { x: 974, y: 608, turn: 150 },
  { x: 502, y: 481, turn: 40 },
]
const HEAD_HOLES = [
  { x: 330, r: 19 },
  { x: 410, r: 10 },
  { x: 502, r: 13 },
  { x: 594, r: 10 },
  { x: 674, r: 19 },
]
const SCALE_TICKS = Array.from({ length: 11 }, (_, index) => index)

/** 실제 물건이라 테마와 상관없이 같은 색이다. */
const SHELL = '#1f2124'
const SHELL_EDGE = '#3b3e43'
const SHELL_RAISED = '#2a2c30'
const GRIP = '#34373c'
const PRINTED = '#131416'
const PRINT = '#d9d5c9'
const PRINT_DIM = '#a8a59b'
const STRIPE = '#7f9cc2'
const PAPER = '#ecebe6'
const PAPER_RULE = '#b9b7af'
const PAPER_CAPTION = '#6d6b64'
const INK = '#202225'
const GLASS = '#4a4e54'
const TAPE = '#17130f'
const HUB = '#d4d6d9'
const HOLE = '#0c0d0e'

/** 카세트는 멈출 때 판보다 빨리 선다. */
const SETTLE_SECONDS = 0.12
const DESKTOP_QUERY = '(min-width: 64rem)'
const PORTRAIT_MAX_HEIGHT = '62dvh'

/** 감긴 테이프의 면적은 보존되므로 반지름은 남은 양의 제곱근을 따른다. */
function getPackRadius(remaining: number) {
  return Math.sqrt(HUB_RADIUS_MM ** 2 + (FULL_RADIUS_MM ** 2 - HUB_RADIUS_MM ** 2) * remaining)
}

/**
 * 음질을 실제 테이프 규격의 이름으로 찍는다. 잠깐 나왔다 사라진 TYPE III(FeCr)는
 * 재생은 되지만 규격이 흔치 않은 파일에 붙인다.
 */
function getTapeType(meta: TrackMeta | undefined, fileName: string) {
  if (meta && isUnusualFormat(meta, fileName)) return 'TYPE III FeCr POSITION'
  if (!meta?.lossless) return 'TYPE I NORMAL POSITION'
  return (meta.bitsPerSample ?? 0) >= 24 ? 'TYPE IV METAL POSITION' : 'TYPE II CHROME POSITION'
}

function percent(value: number, whole: number) {
  return `${(value / whole) * 100}%`
}

interface ReelHubProps {
  center: { x: number; y: number }
  radiusMm: number
  playing: boolean
  reversed: boolean
}

function ReelHub({ center, radiusMm, playing, reversed }: ReelHubProps) {
  const hub = useRef<HTMLDivElement>(null)

  // 테이프 속도가 일정해서 적게 감긴 릴이 더 빨리 돈다.
  useSpin(hub, {
    turnsPerSecond: playing ? TAPE_SPEED_MM / (2 * Math.PI * radiusMm) : 0,
    degrees: -360,
    settleSeconds: SETTLE_SECONDS,
  })

  return (
    <div
      className={cn('absolute aspect-square', reversed && '-scale-x-100')}
      style={{
        left: percent(center.x - HUB_SIZE / 2, WIDTH),
        top: percent(center.y - HUB_SIZE / 2, HEIGHT),
        width: percent(HUB_SIZE, WIDTH),
      }}
    >
      <div ref={hub} data-hub className="size-full">
        <svg viewBox="-54 -54 108 108" className="size-full" aria-hidden="true">
          <circle r="54" fill={HUB} />
          <circle r="36" fill={HOLE} />
          {HUB_TEETH.map((angle) => (
            <rect key={angle} x="-6" y="-38" width="12" height="15" rx="2" transform={`rotate(${angle})`} fill={HUB} />
          ))}
          <circle data-marker cx="45" r="3.5" fill={HOLE} />
        </svg>
      </div>
    </div>
  )
}

interface StickerCellProps {
  name: string
  caption: string
  size: string
  className?: string
  children: ReactNode
}

function StickerCell({ name, caption, size, className, children }: StickerCellProps) {
  return (
    <span className={cn('flex min-w-0 items-center gap-[1cqw] px-[1.2cqw]', className)} style={{ borderColor: PAPER_RULE }}>
      <span className="shrink-0 tracking-wide" style={{ color: PAPER_CAPTION, fontSize: '1.6cqw' }}>
        {caption}
      </span>
      <span data-cell={name} className="min-w-0 truncate font-medium" style={{ fontSize: size }}>
        {children}
      </span>
    </span>
  )
}

interface CassetteViewProps {
  title: string
  /** 확장자로 테이프 규격을 고를 때 쓴다. */
  fileName: string
  meta: TrackMeta | undefined
  className: string
}

/**
 * 곡마다 뒤집는 대신 오토리버스 덱처럼 다음 곡에서 테이프가 반대로 간다. 릴 크기가 끊기지 않고 이어진다.
 * 휴대폰에서는 카세트를 통째로 눕힌다. 글자도 함께 눕는다.
 */
export function CassetteView({ title, fileName, meta, className }: CassetteViewProps) {
  const isPlaying = usePlayer((player) => player.isPlaying)
  const duration = usePlayer((player) => player.duration)
  const progress = usePlayer((player) =>
    player.duration > 0 ? Math.min(player.position / player.duration, 1) : 0,
  )
  const sideB = usePlayer((player) => player.index % 2 === 1)
  const wide = useMediaQuery(DESKTOP_QUERY)
  const gripId = useId()
  const windowId = useId()

  const packs = [
    getPackRadius(sideB ? progress : 1 - progress),
    getPackRadius(sideB ? 1 - progress : progress),
  ]
  const [codec = '', ...spec] = (meta && formatLabel(meta))?.split(' ') ?? []
  const minutes = Math.max(Math.ceil(duration / 60), 1)
  const scaleTop = TAPE_WINDOW.y + TAPE_WINDOW.height / 2

  return (
    <div role="img" aria-label="카세트" className={cn('flex items-center justify-center', className)}>
      <div
        className="relative @container"
        style={
          wide
            ? { width: '100%', aspectRatio: `${WIDTH} / ${HEIGHT}` }
            : {
                width: `min(100%, calc(${PORTRAIT_MAX_HEIGHT} * ${HEIGHT / WIDTH}))`,
                aspectRatio: `${HEIGHT} / ${WIDTH}`,
              }
        }
      >
        <div
          data-cassette
          className={cn(
            '@container',
            wide ? 'relative w-full' : 'absolute top-1/2 left-1/2 -translate-1/2 -rotate-90',
          )}
          style={{
            aspectRatio: `${WIDTH} / ${HEIGHT}`,
            width: wide ? undefined : `calc(100cqw * ${WIDTH / HEIGHT})`,
          }}
        >
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="absolute inset-0 size-full" aria-hidden="true">
            <defs>
              <pattern id={gripId} width="13" height="13" patternUnits="userSpaceOnUse">
                <circle cx="6.5" cy="6.5" r="1.7" fill={GRIP} />
              </pattern>
              <clipPath id={windowId}>
                <rect {...TAPE_WINDOW} rx="6" />
              </clipPath>
            </defs>

            <rect width={WIDTH} height={HEIGHT} rx="26" fill={SHELL} stroke={SHELL_EDGE} strokeWidth="3" />
            <rect x="3" y="3" width={WIDTH - 6} height={HEIGHT - 6} rx="24" fill={`url(#${gripId})`} />
            <polygon points="226,638 256,498 748,498 778,638" fill={SHELL_RAISED} stroke={SHELL_EDGE} strokeWidth="2" />
            {HEAD_HOLES.map((hole) => (
              <circle key={hole.x} cx={hole.x} cy="568" r={hole.r} fill={HOLE} stroke={SHELL_EDGE} strokeWidth="2" />
            ))}
            {SCREWS.map((screw) => (
              <g key={`${screw.x}-${screw.y}`} transform={`translate(${screw.x} ${screw.y}) rotate(${screw.turn})`}>
                <circle r="11" fill={SHELL_EDGE} />
                <line x1="-7" x2="7" strokeWidth="2.5" stroke={HOLE} />
              </g>
            ))}

            <rect {...LABEL} rx="10" fill={PRINTED} />
            <rect x={STICKER.x} y="446" width={STICKER.width} height="4" fill={STRIPE} />

            <rect {...TAPE_WINDOW} rx="6" data-window fill={GLASS} />
            <g clipPath={`url(#${windowId})`}>
              {REELS.map((reel, index) => (
                <circle
                  key={reel.x}
                  data-pack
                  cx={reel.x}
                  cy={reel.y}
                  r={packs[index] * UNITS_PER_MM}
                  fill={TAPE}
                  className="transition-[r] duration-300 ease-out motion-reduce:transition-none"
                />
              ))}
            </g>
            {SCALE_TICKS.map((tick) => {
              const x = TAPE_WINDOW.x + 20 + tick * 22
              const height = tick % 5 === 0 ? 15 : 8
              return (
                <line
                  key={tick}
                  x1={x}
                  x2={x}
                  y1={scaleTop - height}
                  y2={scaleTop + height}
                  strokeWidth="1.5"
                  stroke={PRINT}
                />
              )
            })}
            <line
              x1={TAPE_WINDOW.x + 20}
              x2={TAPE_WINDOW.x + 240}
              y1={scaleTop}
              y2={scaleTop}
              strokeWidth="1.5"
              stroke={PRINT}
            />
            <rect {...TAPE_WINDOW} rx="6" fill="none" stroke={SHELL_EDGE} strokeWidth="2" />

            {REELS.map((reel) => (
              <circle key={reel.x} cx={reel.x} cy={reel.y} r={HOLE_RADIUS} fill={HOLE} stroke={SHELL_EDGE} strokeWidth="2" />
            ))}

            <text data-side x="92" y="368" fontSize="104" fontWeight="600" fill={PRINT}>
              {sideB ? 'B' : 'A'}
            </text>
            <polygon data-direction points={sideB ? '146,396 146,424 118,410' : '98,396 98,424 126,410'} fill={PRINT} />
            <text
              data-codec
              x="922"
              y="330"
              textAnchor="end"
              fontSize={codec.length > 4 ? 34 : 46}
              fontWeight="700"
              fill={PRINT}
            >
              {codec}
            </text>
            <text x="922" y="364" textAnchor="end" fontSize="20" fill={PRINT_DIM}>
              {spec.slice(0, 2).join(' ')}
            </text>
            <text x="922" y="390" textAnchor="end" fontSize="20" fill={PRINT_DIM}>
              {spec.slice(3).join(' ')}
            </text>
            <text data-type x="502" y="268" textAnchor="middle" fontSize="20" letterSpacing="1.5" fill={PRINT}>
              {getTapeType(meta, fileName)}
            </text>
            <text x="502" y="426" textAnchor="middle" fontSize="20" letterSpacing="1.5" fill={PRINT_DIM}>
              {minutes} {minutes === 1 ? 'MINUTE' : 'MINUTES'}
            </text>
          </svg>

          {REELS.map((reel, index) => (
            <ReelHub key={reel.x} center={reel} radiusMm={packs[index]} playing={isPlaying} reversed={sideB} />
          ))}

          <div
            data-label
            className="absolute grid grid-rows-[44%_28%_28%] overflow-hidden rounded-[0.3cqw]"
            style={{
              left: percent(STICKER.x, WIDTH),
              top: percent(STICKER.y, HEIGHT),
              width: percent(STICKER.width, WIDTH),
              height: percent(STICKER.height, HEIGHT),
              backgroundColor: PAPER,
              color: INK,
            }}
          >
            <StickerCell name="title" caption="TITLE" size="3.6cqw" className="border-b">
              {title}
            </StickerCell>
            <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_24%] border-b" style={{ borderColor: PAPER_RULE }}>
              <StickerCell name="artist" caption="ARTIST" size="2.5cqw" className="border-r">
                {meta?.artist ?? ''}
              </StickerCell>
              <StickerCell name="time" caption="TIME" size="2.5cqw">
                {duration > 0 ? formatTime(duration) : ''}
              </StickerCell>
            </span>
            <span className="grid min-w-0 grid-cols-[24%_minmax(0,1fr)]">
              <StickerCell name="codec" caption="CODEC" size="2.5cqw" className="border-r">
                {codec}
              </StickerCell>
              <StickerCell name="format" caption="FORMAT" size="2.5cqw">
                {spec.join(' ')}
              </StickerCell>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
