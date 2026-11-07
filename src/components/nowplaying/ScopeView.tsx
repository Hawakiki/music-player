import { useEffect, useRef, type RefObject } from 'react'
import { advanceMeter, createMeterReader, getMeterWindow } from '@/lib/player/meter-reader'
import {
  COLUMN_SECONDS,
  SPECTRUM_SIZE,
  createColorTable,
  createRowBins,
  createSpectrumReader,
  getFrequencyPosition,
  getStereoStats,
  writeColumn,
} from '@/lib/player/scope'
import { getMeterTap } from '@/lib/player/sound-graph'
import { cn } from '@/lib/utils'
import { usePlayer } from '@/stores/player-store'

/** 실제 계측기처럼 테마와 상관없이 어두운 면이다. */
const FACE = '#14171a'
const TRACE = '#8fb0d9'
const TRACE_OPACITY = 0.4
const PANEL = 'border border-[#2b3036]'

const SPECTROGRAM_MAX_WIDTH = 640
const SPECTROGRAM_MAX_HEIGHT = 320
const VECTORSCOPE_MAX_SIZE = 320
const MAX_COLUMNS_PER_FRAME = 8

const FREQUENCY_MARKS = [
  { hz: 100, label: '100' },
  { hz: 1000, label: '1k' },
  { hz: 10000, label: '10k' },
]

const VECTOR_WINDOW = 2048
const VECTOR_POINT_STEP = 4
/** 작은 소리도 보이도록 가운데를 넓힌다. */
const VECTOR_CURVE = 0.6
/**
 * 궤적은 프레임이 아니라 일정한 간격으로 지우고 그린다. 프레임에 맞추면 주사율이 높을수록 진해지고,
 * 지우는 양이 작아져서 반올림 때문에 잔상이 끝까지 남는다.
 */
const VECTOR_STEP_SECONDS = 1 / 30
const VECTOR_FADE = 0.25
const STATS_SECONDS = 0.15
const STATS_TEXT_MS = 100
/** 멈춘 뒤 궤적이 다 지워질 때까지 그린다. */
const SETTLE_SECONDS = 1.2

function fitCanvas(canvas: HTMLCanvasElement, maxWidth: number, maxHeight: number) {
  const scale = Math.min(window.devicePixelRatio, 2)
  const width = Math.min(Math.round(canvas.clientWidth * scale), maxWidth)
  const height = Math.min(Math.round(canvas.clientHeight * scale), maxHeight)
  if (width === canvas.width && height === canvas.height) return false

  canvas.width = width
  canvas.height = height
  return true
}

function curve(value: number) {
  return Math.sign(value) * Math.abs(value) ** VECTOR_CURVE
}

function fadeVectors(context: CanvasRenderingContext2D) {
  context.globalCompositeOperation = 'destination-out'
  context.fillStyle = `rgb(0 0 0 / ${VECTOR_FADE})`
  context.fillRect(0, 0, context.canvas.width, context.canvas.height)
  context.globalCompositeOperation = 'source-over'
}

function drawVectors(context: CanvasRenderingContext2D, left: Float32Array, right: Float32Array) {
  const { width, height } = context.canvas
  const middleX = width / 2
  const middleY = height / 2

  context.strokeStyle = TRACE
  context.globalAlpha = TRACE_OPACITY
  context.lineWidth = 1
  context.beginPath()
  for (let index = 0; index < left.length; index += VECTOR_POINT_STEP) {
    // 좌우 대신 합과 차로 돌려서, 가운데 소리가 세로줄이 되게 한다.
    const x = middleX + curve((right[index] - left[index]) * Math.SQRT1_2) * middleX * 0.95
    const y = middleY - curve((right[index] + left[index]) * Math.SQRT1_2) * middleY * 0.95
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.stroke()
  context.globalAlpha = 1
}

interface StereoBarProps {
  name: string
  label: string
  start: string
  end: string
  fillRef: RefObject<HTMLSpanElement | null>
  valueRef: RefObject<HTMLSpanElement | null>
}

function StereoBar({ name, label, start, end, fillRef, valueRef }: StereoBarProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between text-caption text-[#9ba1a8]">
        <span>{label}</span>
        <span ref={valueRef} data-stat={name} className="text-[#dcdfe3]">
          -
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-[#2b3036]">
        <span className="absolute top-1/2 left-1/2 h-3 w-px -translate-y-1/2 bg-[#6b7178]" />
        <span ref={fillRef} className="absolute inset-y-0 rounded-full bg-[#8fb0d9]" style={{ left: '50%', width: 0 }} />
      </div>
      <div className="flex justify-between text-[0.6875rem] text-[#80868e]">
        <span>{start}</span>
        <span>{end}</span>
      </div>
    </div>
  )
}

function setBar(fill: HTMLSpanElement | null, text: HTMLSpanElement | null, value: number | null, label: string) {
  if (fill) {
    const position = (value ?? 0) * 50
    fill.style.left = `${50 + Math.min(position, 0)}%`
    fill.style.width = `${Math.abs(position)}%`
    fill.style.backgroundColor = value !== null && value < 0 && fill.dataset.warn ? '#d98a8a' : TRACE
  }
  if (text) text.textContent = label
}

function formatSigned(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`
}

function formatBalance(value: number) {
  if (Math.abs(value) < 0.02) return '가운데'
  return `${value < 0 ? '왼쪽' : '오른쪽'} ${Math.round(Math.abs(value) * 100)}`
}

interface ScopeViewProps {
  className: string
}

export function ScopeView({ className }: ScopeViewProps) {
  const isPlaying = usePlayer((player) => player.isPlaying)

  const spectrogram = useRef<HTMLCanvasElement>(null)
  const vectorscope = useRef<HTMLCanvasElement>(null)
  const correlationFill = useRef<HTMLSpanElement>(null)
  const correlationText = useRef<HTMLSpanElement>(null)
  const balanceFill = useRef<HTMLSpanElement>(null)
  const balanceText = useRef<HTMLSpanElement>(null)

  const animation = useRef(0)
  const lastFrame = useRef(0)
  const lastText = useRef(0)
  const pendingColumns = useRef(0)
  const quietSeconds = useRef(0)
  const vectorSeconds = useRef(0)
  const columns = useRef(0)
  const stats = useRef<{ correlation: number; balance: number } | null>(null)

  useEffect(() => {
    const grid = spectrogram.current
    const scope = vectorscope.current
    const gridContext = grid?.getContext('2d')
    const scopeContext = scope?.getContext('2d')
    if (!grid || !scope || !gridContext || !scopeContext) return

    const colors = createColorTable()
    const reader = createMeterReader()
    const readSpectrum = createSpectrumReader()
    const leftSpectrum = new Float32Array(SPECTRUM_SIZE / 2)
    const rightSpectrum = new Float32Array(SPECTRUM_SIZE / 2)
    let rowBins = new Uint16Array(0)
    let pixels = new ImageData(1, 1)

    const prepare = () => {
      const resized = fitCanvas(grid, SPECTROGRAM_MAX_WIDTH, SPECTROGRAM_MAX_HEIGHT)
      fitCanvas(scope, VECTORSCOPE_MAX_SIZE, VECTORSCOPE_MAX_SIZE)
      if (!resized && rowBins.length > 0) return

      const tap = getMeterTap()
      const sampleRate = tap?.input.context.sampleRate ?? 48000
      rowBins = createRowBins(grid.height, sampleRate / SPECTRUM_SIZE, SPECTRUM_SIZE / 2)
      pixels = new ImageData(1, grid.height)
      gridContext.fillStyle = FACE
      gridContext.fillRect(0, 0, grid.width, grid.height)
    }

    const addColumn = () => {
      readSpectrum(getMeterWindow(reader.left, reader, SPECTRUM_SIZE), leftSpectrum)
      readSpectrum(getMeterWindow(reader.right, reader, SPECTRUM_SIZE), rightSpectrum)
      writeColumn(leftSpectrum, rightSpectrum, rowBins, colors, pixels.data)
      gridContext.drawImage(grid, -1, 0)
      gridContext.putImageData(pixels, grid.width - 1, 0)
      columns.current += 1
      grid.dataset.columns = String(columns.current)
    }

    const showStats = (left: Float32Array, right: Float32Array, now: number, seconds: number) => {
      const next = getStereoStats(left, right)
      const previous = stats.current
      const mix = 1 - Math.exp(-seconds / STATS_SECONDS)
      stats.current =
        next && previous
          ? {
              correlation: previous.correlation + (next.correlation - previous.correlation) * mix,
              balance: previous.balance + (next.balance - previous.balance) * mix,
            }
          : next

      if (now - lastText.current < STATS_TEXT_MS) return
      lastText.current = now

      const current = stats.current
      setBar(correlationFill.current, correlationText.current, current?.correlation ?? null, current ? formatSigned(current.correlation) : '-')
      setBar(balanceFill.current, balanceText.current, current?.balance ?? null, current ? formatBalance(current.balance) : '-')
    }

    const draw = (now: number) => {
      const seconds = Math.max((now - lastFrame.current) / 1000, 0)
      lastFrame.current = now
      prepare()

      const tap = getMeterTap()
      if (tap) {
        advanceMeter(reader, tap, seconds, now)
        const left = getMeterWindow(reader.left, reader, VECTOR_WINDOW)
        const right = getMeterWindow(reader.right, reader, VECTOR_WINDOW)

        vectorSeconds.current += seconds
        if (vectorSeconds.current >= VECTOR_STEP_SECONDS) {
          vectorSeconds.current = 0
          fadeVectors(scopeContext)
          if (isPlaying) drawVectors(scopeContext, left, right)
        }
        showStats(left, right, now, seconds)

        // 프레임이 아니라 시간으로 흐르게 한다. 주사율이 달라도 속도가 같아야 한다.
        if (isPlaying) {
          pendingColumns.current += seconds / COLUMN_SECONDS
          const count = Math.min(Math.floor(pendingColumns.current), MAX_COLUMNS_PER_FRAME)
          pendingColumns.current = count === MAX_COLUMNS_PER_FRAME ? 0 : pendingColumns.current - count
          for (let index = 0; index < count; index += 1) addColumn()
        }
      }

      // 멈춘 뒤 궤적이 사라지면 그리기를 쉰다.
      quietSeconds.current = isPlaying ? 0 : quietSeconds.current + seconds
      if (quietSeconds.current < SETTLE_SECONDS) animation.current = requestAnimationFrame(draw)
    }

    lastFrame.current = performance.now()
    quietSeconds.current = 0
    animation.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animation.current)
  }, [isPlaying])

  return (
    <div
      role="img"
      aria-label="주파수와 스테레오 측정"
      data-scope
      className={cn('grid grid-rows-[minmax(0,1.75fr)_minmax(0,1fr)] gap-2', className)}
    >
      <div className={cn('relative min-h-0 overflow-hidden rounded-lg', PANEL)} style={{ backgroundColor: FACE }}>
        <canvas ref={spectrogram} data-spectrogram className="size-full" />
        {FREQUENCY_MARKS.map(({ hz, label }) => (
          <span
            key={hz}
            className="absolute left-2 -translate-y-1/2 text-[0.6875rem] text-[#9ba1a8]"
            style={{ top: `${(1 - getFrequencyPosition(hz)) * 100}%` }}
          >
            {label}
          </span>
        ))}
      </div>

      <div className="grid min-h-0 grid-cols-[auto_minmax(0,1fr)] gap-2">
        <div
          className={cn('relative aspect-square h-full overflow-hidden rounded-lg', PANEL)}
          style={{ backgroundColor: FACE }}
        >
          <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden="true">
            <line x1="50" y1="4" x2="50" y2="96" stroke="#2b3036" strokeWidth="0.75" />
            <line x1="4" y1="50" x2="96" y2="50" stroke="#2b3036" strokeWidth="0.75" />
            <line x1="17" y1="17" x2="83" y2="83" stroke="#2b3036" strokeWidth="0.5" />
            <line x1="83" y1="17" x2="17" y2="83" stroke="#2b3036" strokeWidth="0.5" />
            <text x="8" y="14" fontSize="8" fill="#80868e">
              L
            </text>
            <text x="86" y="14" fontSize="8" fill="#80868e">
              R
            </text>
          </svg>
          <canvas ref={vectorscope} data-vectorscope className="absolute inset-0 size-full" />
        </div>

        <div
          className={cn('flex min-w-0 flex-col justify-center gap-3 rounded-lg px-4', PANEL)}
          style={{ backgroundColor: FACE }}
        >
          <StereoBar
            name="correlation"
            label="위상"
            start="반대"
            end="같음"
            fillRef={correlationFill}
            valueRef={correlationText}
          />
          <StereoBar
            name="balance"
            label="좌우"
            start="왼쪽"
            end="오른쪽"
            fillRef={balanceFill}
            valueRef={balanceText}
          />
        </div>
      </div>
    </div>
  )
}
