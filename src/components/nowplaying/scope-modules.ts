import { createLoudnessMeter } from '@/lib/player/loudness'
import { getMeterPeak, type MeterReader } from '@/lib/player/meter-reader'
import {
  COLUMN_SECONDS,
  SPECTRUM_SIZE,
  createColorTable,
  createColumnEdges,
  createRowBins,
  findLoudest,
  getFrequencyPosition,
  getNoteName,
  getSpectrumLevels,
  getStereoStats,
  readColumn,
  writeColumn,
  type ScopeModuleId,
} from '@/lib/player/scope'
import { VU_MARKS, getAverageLevel, getNeedleTarget, moveNeedle, vuToPosition, type Needle } from '@/lib/player/vu-meter'

/** 실제 계측기처럼 테마와 상관없이 어두운 면이다. */
export const SCOPE_FACE = '#14171a'
const GRID = '#2b3036'
const LABEL = '#80868e'
const TEXT = '#9ba1a8'
const BRIGHT = '#dcdfe3'
const TRACE = '#8fb0d9'
const OVER = '#d98a8a'
const FONT = '"Pretendard Variable", Pretendard, system-ui, sans-serif'

const MAX_WIDTH = 640
const MAX_HEIGHT = 320
const MAX_COLUMNS_PER_FRAME = 8

/** 궤적과 곡선은 프레임이 아니라 일정한 간격으로 그린다. 주사율이 달라도 같아 보여야 한다. */
const DRAW_STEP_SECONDS = 1 / 30
const VECTOR_FADE = 0.25
/** 1kHz 사인의 주기(48샘플)를 나누는 간격이면 같은 자리만 찍혀서 줄이 끊겨 보인다. */
const VECTOR_POINT_STEP = 5
/** 작은 소리도 보이도록 가운데를 넓힌다. */
const VECTOR_CURVE = 0.6

/** 꽉 찬 사인이 -13.6dB로 읽힌다. 위에 여유를 둬서 큰 저음이 잘리지 않게 한다. */
const SPECTRUM_TOP_DB = -10
const SPECTRUM_BOTTOM_DB = -100
const SPECTRUM_RELEASE_DB_PER_SECOND = 60
const PEAK_RELEASE_DB_PER_SECOND = 8
const NOTE_FLOOR_DB = -70
const FREQUENCY_MARKS = [
  { hz: 100, label: '100' },
  { hz: 1000, label: '1k' },
  { hz: 10000, label: '10k' },
]

const LEVEL_FLOOR_DB = -60
const LEVEL_MARKS = [0, -6, -12, -24, -48]
/** 리미터 앞에서 재서 요즘 곡은 0을 자주 넘는다. 피크 LED와 같은 기준이다. */
const LEVEL_OVER_DB = 1
const LEVEL_ATTACK_SECONDS = 0.03
const LEVEL_RELEASE_SECONDS = 0.3
const LEVEL_PEAK_HOLD_MS = 1500
const LEVEL_PEAK_RELEASE_DB_PER_SECOND = 20
const TEXT_STEP_MS = 100

const STATS_SECONDS = 0.15
const SCOPE_SAMPLES = 1200
/** 꽉 찬 소리도 칸을 넘지 않게 한다. 잘리면 파형을 보는 의미가 없다. */
const SCOPE_GAIN = 0.95
const VU_SWEEP_DEGREES = 42

export interface ScopeFrame {
  left: Float32Array
  right: Float32Array
  reader: MeterReader
  sampleRate: number
  now: number
  seconds: number
  playing: boolean
  vuReferenceDb: number
  /** 그릴 때 필요한 모듈만 부른다. 같은 프레임에서는 한 번만 계산한다. */
  spectrum: () => { left: Float32Array; right: Float32Array }
}

export type ScopeDrawer = (frame: ScopeFrame) => void

/** 가로세로를 같은 비율로 줄인다. 따로 줄이면 글자와 원이 찌그러진다. */
function fit(canvas: HTMLCanvasElement) {
  const { clientWidth, clientHeight } = canvas
  const scale = Math.min(window.devicePixelRatio, 2, MAX_WIDTH / clientWidth, MAX_HEIGHT / clientHeight)
  const width = Math.round(clientWidth * scale)
  const height = Math.round(clientHeight * scale)
  if (width === canvas.width && height === canvas.height) return false

  canvas.width = width
  canvas.height = height
  return true
}

function createStepper() {
  let elapsed = 0
  return (seconds: number) => {
    elapsed += seconds
    if (elapsed < DRAW_STEP_SECONDS) return false
    elapsed = 0
    return true
  }
}

function getContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('캔버스를 만들 수 없습니다.')
  return context
}

function font(context: CanvasRenderingContext2D, size: number, weight = 400) {
  context.font = `${weight} ${size}px ${FONT}`
}

function getTextSize({ canvas }: CanvasRenderingContext2D) {
  return Math.max(canvas.width / Math.max(canvas.clientWidth, 1), 1) * 11
}

function clear(context: CanvasRenderingContext2D) {
  context.fillStyle = SCOPE_FACE
  context.fillRect(0, 0, context.canvas.width, context.canvas.height)
}

function createSpectrogram(canvas: HTMLCanvasElement): ScopeDrawer {
  const context = getContext(canvas)
  const colors = createColorTable()
  let rowBins = new Uint16Array(0)
  let pixels = new ImageData(1, 1)
  let rate = 0
  let pending = 0
  let columns = 0

  return (frame) => {
    // 재생 전에는 그래프가 없어서 샘플레이트를 어림한다. 실제 값을 알면 다시 구해야 한다.
    if (fit(canvas) || rate !== frame.sampleRate) {
      rate = frame.sampleRate
      rowBins = createRowBins(canvas.height, frame.sampleRate / SPECTRUM_SIZE, SPECTRUM_SIZE / 2)
      pixels = new ImageData(1, canvas.height)
      clear(context)
    }
    if (!frame.playing) return

    // 프레임이 아니라 시간으로 흐르게 한다. 주사율이 달라도 속도가 같아야 한다.
    pending += frame.seconds / COLUMN_SECONDS
    const count = Math.min(Math.floor(pending), MAX_COLUMNS_PER_FRAME)
    pending = count === MAX_COLUMNS_PER_FRAME ? 0 : pending - count
    if (count === 0) return

    const { left, right } = frame.spectrum()
    writeColumn(left, right, rowBins, colors, pixels.data)
    for (let index = 0; index < count; index += 1) {
      context.drawImage(canvas, -1, 0)
      context.putImageData(pixels, canvas.width - 1, 0)
      columns += 1
    }
    canvas.dataset.columns = String(columns)
  }
}

function createSpectrum(canvas: HTMLCanvasElement): ScopeDrawer {
  const context = getContext(canvas)
  const step = createStepper()
  const levels = new Float32Array(SPECTRUM_SIZE / 2)
  let edges = new Float32Array(0)
  let line = new Float32Array(0)
  let peaks = new Float32Array(0)
  let rate = 0
  let elapsed = 0
  let lastText = 0
  let note = ''

  const getY = (db: number) => {
    const ratio = (SPECTRUM_TOP_DB - db) / (SPECTRUM_TOP_DB - SPECTRUM_BOTTOM_DB)
    return Math.min(Math.max(ratio, 0), 1) * canvas.height
  }

  const trace = (values: Float32Array) => {
    context.beginPath()
    values.forEach((db, x) => {
      if (x === 0) context.moveTo(x, getY(db))
      else context.lineTo(x, getY(db))
    })
  }

  return (frame) => {
    elapsed += frame.seconds
    const binHz = frame.sampleRate / SPECTRUM_SIZE
    if (fit(canvas) || rate !== frame.sampleRate) {
      rate = frame.sampleRate
      edges = createColumnEdges(canvas.width, binHz, levels.length)
      line = new Float32Array(canvas.width).fill(SPECTRUM_BOTTOM_DB)
      peaks = new Float32Array(canvas.width).fill(SPECTRUM_BOTTOM_DB)
    }
    if (!step(frame.seconds)) return

    const seconds = elapsed
    elapsed = 0
    const { left, right } = frame.spectrum()
    getSpectrumLevels(left, right, levels)
    const { width, height } = canvas

    for (let x = 0; x < width; x += 1) {
      const db = readColumn(levels, edges[x], edges[x + 1])
      line[x] = Math.max(db, line[x] - SPECTRUM_RELEASE_DB_PER_SECOND * seconds)
      peaks[x] = Math.max(db, peaks[x] - PEAK_RELEASE_DB_PER_SECOND * seconds)
    }

    clear(context)
    const textSize = getTextSize(context)
    font(context, textSize)
    context.textBaseline = 'bottom'
    context.lineWidth = 1
    for (const { hz, label } of FREQUENCY_MARKS) {
      const x = getFrequencyPosition(hz) * width
      context.strokeStyle = GRID
      context.beginPath()
      context.moveTo(x, 0)
      context.lineTo(x, height)
      context.stroke()
      context.fillStyle = LABEL
      context.fillText(label, x + textSize * 0.3, height - textSize * 0.2)
    }

    trace(line)
    context.lineTo(width, height)
    context.lineTo(0, height)
    context.closePath()
    context.fillStyle = 'rgb(143 176 217 / 22%)'
    context.fill()

    trace(line)
    context.strokeStyle = TRACE
    context.lineWidth = Math.max(textSize / 9, 1)
    context.stroke()

    trace(peaks)
    context.strokeStyle = 'rgb(220 223 227 / 40%)'
    context.lineWidth = 1
    context.stroke()

    if (frame.now - lastText >= TEXT_STEP_MS) {
      lastText = frame.now
      const loudest = findLoudest(levels, binHz)
      note = loudest.db > NOTE_FLOOR_DB ? `${Math.round(loudest.hz)} Hz  ${getNoteName(loudest.hz)}` : ''
      canvas.dataset.note = note
    }
    if (!note) return

    // 곡선 위에 얹혀도 읽히도록 바탕을 깐다.
    const margin = textSize * 0.5
    context.fillStyle = 'rgb(20 23 26 / 75%)'
    context.fillRect(margin, margin, context.measureText(note).width + margin * 2, textSize * 1.6)
    context.fillStyle = BRIGHT
    context.textBaseline = 'middle'
    context.fillText(note, margin * 2, margin + textSize * 0.8)
  }
}

function getRmsDb(samples: Float32Array) {
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return 10 * Math.log10(sum / samples.length + 1e-12)
}

function createLevel(canvas: HTMLCanvasElement): ScopeDrawer {
  const context = getContext(canvas)
  const step = createStepper()
  const levels = [LEVEL_FLOOR_DB, LEVEL_FLOOR_DB]
  const peaks = [LEVEL_FLOOR_DB, LEVEL_FLOOR_DB]
  const peakUntil = [0, 0]
  let meter: ReturnType<typeof createLoudnessMeter> | null = null
  let meterRate = 0
  let lastText = 0
  let lufsText = '-'
  let rmsText = '-'

  return (frame) => {
    fit(canvas)
    const { reader, seconds, now } = frame

    // 멈추면 쌓인 소리를 버린다. 지난 값이 멈춘 화면에 남으면 안 된다.
    if (!frame.playing || meterRate !== frame.sampleRate) {
      meter = createLoudnessMeter(frame.sampleRate)
      meterRate = frame.sampleRate
    }
    meter?.add(reader.left, reader.right, Math.floor(reader.previous), Math.floor(reader.cursor))

    const rms = [getRmsDb(frame.left), getRmsDb(frame.right)]
    const spans = [getMeterPeak(reader.left, reader), getMeterPeak(reader.right, reader)]
    rms.forEach((db, side) => {
      const time = db > levels[side] ? LEVEL_ATTACK_SECONDS : LEVEL_RELEASE_SECONDS
      levels[side] += (db - levels[side]) * (1 - Math.exp(-seconds / time))

      const peak = 20 * Math.log10(spans[side] + 1e-12)
      if (peak >= peaks[side]) {
        peaks[side] = peak
        peakUntil[side] = now + LEVEL_PEAK_HOLD_MS
      } else if (now > peakUntil[side]) {
        peaks[side] -= LEVEL_PEAK_RELEASE_DB_PER_SECOND * seconds
      }
    })

    if (now - lastText >= TEXT_STEP_MS) {
      lastText = now
      const momentary = meter?.getMomentary() ?? null
      const average = 10 * Math.log10((10 ** (levels[0] / 10) + 10 ** (levels[1] / 10)) / 2)
      lufsText = momentary === null ? '-' : momentary.toFixed(1)
      rmsText = average < LEVEL_FLOOR_DB ? '-' : average.toFixed(1)
      canvas.dataset.lufs = lufsText
      canvas.dataset.rms = rmsText
    }

    if (!step(seconds)) return

    const { width, height } = canvas
    const textSize = getTextSize(context)
    const top = textSize * 1.1
    const bottom = height - textSize * 1.1
    const scaleWidth = textSize * 2.2
    const barWidth = width * 0.07
    const gap = barWidth * 0.35
    const getY = (db: number) => top + (Math.min(-db, -LEVEL_FLOOR_DB) / -LEVEL_FLOOR_DB) * (bottom - top)

    clear(context)
    font(context, textSize * 0.9)
    context.textAlign = 'right'
    context.textBaseline = 'middle'
    for (const mark of LEVEL_MARKS) {
      context.fillStyle = LABEL
      context.fillText(String(Math.abs(mark)), scaleWidth - textSize * 0.4, getY(mark))
    }

    for (let side = 0; side < 2; side += 1) {
      const x = scaleWidth + side * (barWidth + gap)
      context.fillStyle = GRID
      context.fillRect(x, top, barWidth, bottom - top)
      context.fillStyle = TRACE
      const y = getY(Math.min(levels[side], 0))
      context.fillRect(x, y, barWidth, bottom - y)
      context.fillStyle = peaks[side] >= LEVEL_OVER_DB ? OVER : BRIGHT
      context.fillRect(x, getY(Math.min(peaks[side], 0)) - 1, barWidth, Math.max(textSize / 7, 1.5))
    }

    const textX = width - textSize * 0.9
    context.textAlign = 'right'
    context.textBaseline = 'alphabetic'
    const bigSize = Math.min(height * 0.18, width * 0.16)
    font(context, bigSize, 500)
    context.fillStyle = BRIGHT
    context.fillText(lufsText, textX, height * 0.5)
    font(context, textSize)
    context.fillStyle = TEXT
    context.fillText('LUFS', textX, height * 0.5 + textSize * 1.3)
    context.fillStyle = LABEL
    context.fillText(`RMS ${rmsText}`, textX, height * 0.5 + textSize * 2.8)
    context.textAlign = 'left'
  }
}

function createVectorscope(canvas: HTMLCanvasElement): ScopeDrawer {
  const context = getContext(canvas)
  const step = createStepper()

  return (frame) => {
    fit(canvas)
    if (!step(frame.seconds)) return

    const { width, height } = canvas
    const size = Math.min(width, height) * 0.46
    const middleX = width / 2
    const middleY = height / 2

    // 지우는 양을 프레임에 맞춰 줄이면 반올림 때문에 잔상이 끝까지 남는다.
    context.globalCompositeOperation = 'destination-out'
    context.fillStyle = `rgb(0 0 0 / ${VECTOR_FADE})`
    context.fillRect(0, 0, width, height)
    context.globalCompositeOperation = 'source-over'

    context.strokeStyle = GRID
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(middleX, middleY - size)
    context.lineTo(middleX, middleY + size)
    context.moveTo(middleX - size, middleY)
    context.lineTo(middleX + size, middleY)
    context.moveTo(middleX - size * 0.7, middleY - size * 0.7)
    context.lineTo(middleX + size * 0.7, middleY + size * 0.7)
    context.moveTo(middleX + size * 0.7, middleY - size * 0.7)
    context.lineTo(middleX - size * 0.7, middleY + size * 0.7)
    context.stroke()

    const textSize = getTextSize(context)
    font(context, textSize)
    context.fillStyle = LABEL
    context.textAlign = 'center'
    context.textBaseline = 'top'
    // 칸 이름 아래로 내려서 겹치지 않게 한다.
    const labelY = Math.max(middleY - size * 0.72, textSize * 2.4)
    context.fillText('L', middleX - size * 0.82, labelY)
    context.fillText('R', middleX + size * 0.82, labelY)
    context.textAlign = 'left'

    if (!frame.playing) return

    const dot = Math.max(textSize / 7, 1.5)
    context.fillStyle = TRACE
    context.globalAlpha = 0.55
    const { left, right } = frame
    for (let index = 0; index < left.length; index += VECTOR_POINT_STEP) {
      // 좌우 대신 합과 차로 돌려서, 가운데 소리가 세로줄이 되게 한다.
      const side = (right[index] - left[index]) / 2
      const mid = (right[index] + left[index]) / 2
      // 방향이 곧 좌우 위치라서 거리만 넓힌다. 축마다 넓히면 방향이 틀어지고 가운데가 비어 보인다.
      const scale = size * Math.hypot(side, mid) ** (VECTOR_CURVE - 1)
      context.fillRect(middleX + side * scale, middleY - mid * scale, dot, dot)
    }
    context.globalAlpha = 1
  }
}

function formatSigned(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`
}

function formatBalance(value: number) {
  if (Math.abs(value) < 0.02) return '가운데'
  return `${value < 0 ? '왼쪽' : '오른쪽'} ${Math.round(Math.abs(value) * 100)}`
}

function createStereo(canvas: HTMLCanvasElement): ScopeDrawer {
  const context = getContext(canvas)
  const step = createStepper()
  let stats: { correlation: number; balance: number } | null = null
  let lastText = 0
  let correlationText = '-'
  let balanceText = '-'

  const drawBar = (y: number, title: string, value: string, amount: number | null, start: string, end: string) => {
    const { width } = canvas
    const textSize = getTextSize(context)
    const margin = textSize * 1.3
    const barWidth = width - margin * 2
    const middle = margin + barWidth / 2

    font(context, textSize * 1.15)
    context.textBaseline = 'alphabetic'
    context.fillStyle = TEXT
    context.textAlign = 'left'
    context.fillText(title, margin, y)
    context.fillStyle = BRIGHT
    context.textAlign = 'right'
    context.fillText(value, width - margin, y)

    const barY = y + textSize * 0.6
    const barHeight = textSize * 0.5
    context.fillStyle = GRID
    context.fillRect(margin, barY, barWidth, barHeight)
    context.fillStyle = TRACE
    if (amount !== null) {
      const size = (amount * barWidth) / 2
      context.fillRect(Math.min(middle, middle + size), barY, Math.abs(size), barHeight)
    }
    context.fillStyle = LABEL
    context.fillRect(middle, barY - textSize * 0.2, 1, barHeight + textSize * 0.4)

    font(context, textSize * 0.9)
    context.textAlign = 'left'
    context.fillText(start, margin, barY + barHeight + textSize * 1.1)
    context.textAlign = 'right'
    context.fillText(end, width - margin, barY + barHeight + textSize * 1.1)
    context.textAlign = 'left'
  }

  return (frame) => {
    fit(canvas)
    const next = getStereoStats(frame.left, frame.right)
    const mix = 1 - Math.exp(-frame.seconds / STATS_SECONDS)
    stats =
      next && stats
        ? {
            correlation: stats.correlation + (next.correlation - stats.correlation) * mix,
            balance: stats.balance + (next.balance - stats.balance) * mix,
          }
        : next

    if (frame.now - lastText >= TEXT_STEP_MS) {
      lastText = frame.now
      correlationText = stats ? formatSigned(stats.correlation) : '-'
      balanceText = stats ? formatBalance(stats.balance) : '-'
      canvas.dataset.correlation = correlationText
      canvas.dataset.balance = balanceText
    }

    if (!step(frame.seconds)) return

    clear(context)
    const { height } = canvas
    drawBar(height * 0.3, '위상', correlationText, stats?.correlation ?? null, '반대', '같음')
    drawBar(height * 0.72, '좌우', balanceText, stats?.balance ?? null, '왼쪽', '오른쪽')
  }
}

function createOscilloscope(canvas: HTMLCanvasElement): ScopeDrawer {
  const context = getContext(canvas)
  const step = createStepper()

  return (frame) => {
    fit(canvas)
    if (!step(frame.seconds)) return

    const { width, height } = canvas
    const { left, right } = frame
    const middle = height / 2

    // 올라가며 0을 지나는 지점에서 시작해야 파형이 제자리에 서 있는다.
    let start = 0
    for (let index = 1; index < left.length - SCOPE_SAMPLES; index += 1) {
      if (left[index - 1] + right[index - 1] < 0 && left[index] + right[index] >= 0) {
        start = index
        break
      }
    }

    clear(context)
    context.strokeStyle = GRID
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(0, middle)
    context.lineTo(width, middle)
    context.stroke()

    context.strokeStyle = TRACE
    context.lineWidth = Math.max(getTextSize(context) / 9, 1)
    context.beginPath()
    for (let x = 0; x < width; x += 1) {
      const index = start + Math.floor((x / width) * SCOPE_SAMPLES)
      const y = middle - ((left[index] + right[index]) / 2) * SCOPE_GAIN * middle
      if (x === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    }
    context.stroke()
  }
}

function createVu(canvas: HTMLCanvasElement): ScopeDrawer {
  const context = getContext(canvas)
  const needle: Needle = { position: 0, velocity: 0 }

  return (frame) => {
    fit(canvas)
    const target = (getAverageLevel(frame.left) + getAverageLevel(frame.right)) / 2
    moveNeedle(needle, getNeedleTarget(target, frame.vuReferenceDb), frame.seconds)
    canvas.dataset.vu = (20 * Math.log10(Math.max(needle.position, 1e-4)) + 3).toFixed(2)

    const { width, height } = canvas
    const textSize = getTextSize(context)
    const radius = Math.min(width * 0.6, height * 1.05)
    const pivotX = width / 2
    const pivotY = height * 0.32 + radius
    const toAngle = (position: number) => ((position * 2 - 1) * VU_SWEEP_DEGREES * Math.PI) / 180
    const toPoint = (position: number, distance: number) => ({
      x: pivotX + distance * Math.sin(toAngle(position)),
      y: pivotY - distance * Math.cos(toAngle(position)),
    })
    const drawArc = (from: number, to: number, color: string, thickness: number) => {
      context.strokeStyle = color
      context.lineWidth = thickness
      context.beginPath()
      context.arc(pivotX, pivotY, radius, toAngle(from) - Math.PI / 2, toAngle(to) - Math.PI / 2)
      context.stroke()
    }

    clear(context)
    font(context, textSize * 0.95)
    context.textAlign = 'center'
    context.textBaseline = 'middle'

    const line = Math.max(textSize / 9, 1)
    drawArc(vuToPosition(VU_MARKS[0]), vuToPosition(0), TEXT, line)
    drawArc(vuToPosition(0), 1, OVER, line * 3)
    context.lineWidth = line

    for (const vu of VU_MARKS) {
      const position = vuToPosition(vu)
      const inner = toPoint(position, radius - textSize * 0.7)
      const outer = toPoint(position, radius)
      context.strokeStyle = vu > 0 ? OVER : TEXT
      context.beginPath()
      context.moveTo(inner.x, inner.y)
      context.lineTo(outer.x, outer.y)
      context.stroke()

      if (vu === -20 || vu === -10 || vu === -5 || vu === 0 || vu === 3) {
        const text = toPoint(position, radius + textSize * 1.1)
        context.fillStyle = vu > 0 ? OVER : TEXT
        context.fillText(vu > 0 ? `+${vu}` : String(vu), text.x, text.y)
      }
    }

    // 실물처럼 바늘 축은 아래 가림막 뒤에 있어서 칸 밖으로 이어진다.
    const tip = toPoint(needle.position, radius - textSize * 0.2)
    context.strokeStyle = BRIGHT
    context.lineWidth = Math.max(textSize / 6, 1.5)
    context.beginPath()
    context.moveTo(pivotX, pivotY)
    context.lineTo(tip.x, tip.y)
    context.stroke()

    context.fillStyle = LABEL
    context.textAlign = 'left'
    context.textBaseline = 'alphabetic'
    context.fillText('VU', textSize * 0.9, height - textSize * 0.8)
  }
}

const FACTORIES: Record<ScopeModuleId, (canvas: HTMLCanvasElement) => ScopeDrawer> = {
  spectrogram: createSpectrogram,
  spectrum: createSpectrum,
  level: createLevel,
  vectorscope: createVectorscope,
  stereo: createStereo,
  oscilloscope: createOscilloscope,
  vu: createVu,
}

export function createScopeModule(module: ScopeModuleId, canvas: HTMLCanvasElement) {
  return FACTORIES[module](canvas)
}
