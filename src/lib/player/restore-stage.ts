import { createButterworth, dbToGain } from './audio-nodes'

export const RESTORE_INTERVAL_MS = 250

const FFT_SIZE = 4096
/** 이만큼 모은 뒤에 판단한다. 곡 초반은 고역이 어두워서 값이 흔들린다. */
const MIN_FRAMES = 16
/** 이만큼 모아도 절벽이 없으면 잘리지 않은 곡으로 본다. */
const UNDECIDED_FRAMES = 40
const LOUD_FRAME_DB = -90
/** 곡이 바뀐 직후의 측정에는 앞 곡이 남아 있다. 한 번만 섞여도 앞 곡의 절벽을 찾게 된다. */
const SETTLE_TICKS = 2

const BAND_HZ = 250
const SEARCH_MIN_HZ = 11000
const SEARCH_MAX_HZ = 20000
/** 320kbps MP3는 절벽이 20kHz 언저리에서 오간다. 이만큼 넘는 곳까지는 같은 곡으로 본다. */
const SEARCH_SLACK_HZ = 500
/** 절벽 위아래로 이만큼 떨어져서 재야 인코더의 완만한 경계도 절벽으로 잡힌다. */
const EDGE_GAP_HZ = 250
const EDGE_SPAN_HZ = 750
const CLIFF_DB = 20
/** 일단 찾은 뒤에는 더 약한 절벽도 인정한다. 안 그러면 고역이 켜졌다 꺼졌다 한다. */
const KEEP_CLIFF_DB = 10
const QUIET_DB = -115
/** 잘린 지점이 이보다 적게 움직이면 그대로 둔다. */
const MOVE_MIN_HZ = 500

const TOP_HZ = 22000
const TOP_SAMPLE_RATE_RATIO = 0.48
const SOURCE_MARGIN_HZ = 750
/** 잘린 지점 조금 아래부터 채워야 경계가 패이지 않는다. */
const LAYER_EDGE_OFFSET_HZ = -500
/** 실제 고역은 위로 갈수록 옮겨 온 대역보다 빨리 줄어든다. */
const TILT_OFFSET_HZ = 3000
/** 옮기면서 절반이 되는 크기와 필터 경계에서 줄어드는 크기를 되돌린다. 원본 고역과 맞춰 정한 값이다. */
const LAYER_MAKEUP_DB = 12
/** 절벽 바로 아래가 듬성듬성한 곡은 계산이 크게 나온다. 큰 순간 소리가 나지 않게 막는다. */
const LAYER_MAX_DB = 6

const MOVE_SECONDS = 0.05
const FADE_SECONDS = 0.3
const CUT_SECONDS = 0.02

/** 원본 고역에 가장 가까운 크기가 중간이다. */
const RESTORE_LEVELS = { light: -6, medium: 0, strong: 4 }

export type RestoreLevel = 'off' | keyof typeof RESTORE_LEVELS

/** 숫자면 그 주파수(Hz) 위를 채우는 중이다. */
export type RestoreStatus = 'analyzing' | 'none' | number

export interface CutoffResult {
  cutoff: number
  dropDb: number
}

export interface RestoreStage {
  input: GainNode
  output: GainNode
  gate: GainNode
  analyser: AnalyserNode
  sourceLow: BiquadFilterNode[]
  sourceHigh: BiquadFilterNode[]
  shift: OscillatorNode
  layerEdge: BiquadFilterNode[]
  tilt: BiquadFilterNode
  layer: GainNode
  frame: Float32Array<ArrayBuffer>
  sum: Float64Array<ArrayBuffer>
  mean: Float64Array<ArrayBuffer>
  frames: number
  settle: number
  strength: RestoreLevel
  cutoff: number | null
}

function bandDb(power: Float64Array, binHz: number, from: number, to: number) {
  const first = Math.max(1, Math.round(from / binHz))
  const last = Math.min(power.length - 1, Math.round(to / binHz))
  if (last < first) return -Infinity

  let sum = 0
  for (let bin = first; bin <= last; bin += 1) sum += power[bin]
  return 10 * Math.log10(sum / (last - first + 1) + 1e-30)
}

/**
 * 손실 압축은 고역을 절벽처럼 자른다. 자연스러운 고역은 완만하게 줄어서 절벽이 없다.
 * 소리 파워의 장기 평균에서 가장 가파른 곳을 찾고, 없으면 null을 돌려준다.
 */
export function detectCutoff(power: Float64Array, binHz: number, minDropDb = CLIFF_DB): CutoffResult | null {
  let best: CutoffResult | null = null

  for (let edge = SEARCH_MIN_HZ; edge <= SEARCH_MAX_HZ + 1500; edge += BAND_HZ) {
    const below = bandDb(power, binHz, edge - EDGE_GAP_HZ - EDGE_SPAN_HZ, edge - EDGE_GAP_HZ)
    const above = bandDb(power, binHz, edge + EDGE_GAP_HZ, edge + EDGE_GAP_HZ + EDGE_SPAN_HZ)
    if (below < QUIET_DB) continue

    const dropDb = below - above
    if (dropDb >= minDropDb && (!best || dropDb > best.dropDb)) best = { cutoff: edge, dropDb }
  }

  if (!best || best.cutoff > SEARCH_MAX_HZ + SEARCH_SLACK_HZ) return null
  return { ...best, cutoff: Math.min(best.cutoff, SEARCH_MAX_HZ) }
}

/** 옮겨 올 대역의 폭. 위쪽 끝까지 채우되 잘린 지점의 절반 아래는 쓰지 않는다. */
function getShiftHz(cutoff: number, sampleRate: number) {
  const top = Math.min(TOP_HZ, sampleRate * TOP_SAMPLE_RATE_RATIO)
  return Math.min(top - cutoff, cutoff / 2)
}

/**
 * 잘린 지점 바로 아래 대역을 위로 옮겨서 채운다. HE-AAC의 SBR과 같은 생각이다.
 * 소리의 시간 변화가 그대로 살아서 왜곡으로 배음을 만드는 쪽보다 원본 고역에 가깝다.
 * 원음은 건드리지 않고 비어 있던 대역에만 더하므로 시간을 맞출 필요가 없다.
 */
export function createRestoreStage(context: BaseAudioContext): RestoreStage {
  const input = context.createGain()
  const output = context.createGain()
  input.connect(output)

  const gate = context.createGain()
  gate.gain.value = 0
  input.connect(gate)

  const analyser = context.createAnalyser()
  analyser.fftSize = FFT_SIZE
  analyser.smoothingTimeConstant = 0
  gate.connect(analyser)

  const createFilters = (count: number, type: 'lowpass' | 'highpass') =>
    Array.from({ length: count }, () => createButterworth(context, type, TOP_HZ))
  const sourceLow = createFilters(2, 'highpass')
  const sourceHigh = createFilters(2, 'lowpass')
  const layerEdge = createFilters(4, 'highpass')
  const tilt = createButterworth(context, 'lowpass', TOP_HZ)

  // 소리에 사인파를 곱하면 주파수가 그만큼 위아래로 옮겨진다. 아래로 간 쪽은 뒤의 필터가 없앤다.
  const ring = context.createGain()
  ring.gain.value = 0
  const shift = context.createOscillator()
  shift.connect(ring.gain)
  shift.start()

  const layer = context.createGain()
  layer.gain.value = 0

  let node: AudioNode = gate
  for (const next of [...sourceLow, ...sourceHigh, ring, ...layerEdge, tilt, layer]) {
    node.connect(next)
    node = next
  }
  layer.connect(output)

  const bins = analyser.frequencyBinCount
  return {
    input,
    output,
    gate,
    analyser,
    sourceLow,
    sourceHigh,
    shift,
    layerEdge,
    tilt,
    layer,
    frame: new Float32Array(bins),
    sum: new Float64Array(bins),
    mean: new Float64Array(bins),
    frames: 0,
    settle: 0,
    strength: 'off',
    cutoff: null,
  }
}

function moveLayer(stage: RestoreStage, cutoff: number) {
  const { context } = stage.input
  const at = context.currentTime
  const shiftHz = getShiftHz(cutoff, context.sampleRate)
  const move = (filter: BiquadFilterNode, frequency: number) =>
    filter.frequency.setTargetAtTime(frequency, at, MOVE_SECONDS)

  stage.shift.frequency.setTargetAtTime(shiftHz, at, MOVE_SECONDS)
  stage.sourceLow.forEach((filter) => move(filter, cutoff - shiftHz - SOURCE_MARGIN_HZ))
  stage.sourceHigh.forEach((filter) => move(filter, cutoff))
  stage.layerEdge.forEach((filter) => move(filter, cutoff + LAYER_EDGE_OFFSET_HZ))
  move(stage.tilt, cutoff + TILT_OFFSET_HZ)
}

/** 잘린 지점 바로 아래의 크기에서 이어지도록, 옮겨 올 대역의 시작 크기와의 차이만큼 맞춘다. */
function getLayerGain(stage: RestoreStage) {
  const { cutoff, strength, mean } = stage
  if (cutoff === null || strength === 'off') return 0

  const { sampleRate } = stage.input.context
  const binHz = sampleRate / FFT_SIZE
  const start = cutoff - getShiftHz(cutoff, sampleRate)
  const near = bandDb(mean, binHz, cutoff - 1000, cutoff - EDGE_GAP_HZ)
  const copied = bandDb(mean, binHz, start + EDGE_GAP_HZ, start + 1000)
  return dbToGain(Math.min(near - copied + LAYER_MAKEUP_DB, LAYER_MAX_DB) + RESTORE_LEVELS[strength])
}

function readFrame({ analyser, frame, sum }: RestoreStage) {
  analyser.getFloatFrequencyData(frame)

  let loud = false
  for (const db of frame) {
    if (db > LOUD_FRAME_DB) {
      loud = true
      break
    }
  }
  if (!loud) return false

  frame.forEach((db, bin) => {
    if (Number.isFinite(db)) sum[bin] += 10 ** (db / 10)
  })
  return true
}

function getRestoreStatus({ cutoff, frames }: RestoreStage): RestoreStatus {
  if (cutoff !== null) return cutoff
  return frames < UNDECIDED_FRAMES ? 'analyzing' : 'none'
}

/** 지금 소리를 한 번 재고, 잘린 지점과 채울 크기를 고친다. */
export function measureRestore(stage: RestoreStage): RestoreStatus {
  if (stage.settle > 0) {
    stage.settle -= 1
    return getRestoreStatus(stage)
  }

  if (readFrame(stage)) stage.frames += 1
  if (stage.frames < MIN_FRAMES) return getRestoreStatus(stage)

  const { context } = stage.input
  stage.sum.forEach((value, bin) => {
    stage.mean[bin] = value / stage.frames
  })

  const minDropDb = stage.cutoff === null ? CLIFF_DB : KEEP_CLIFF_DB
  const found = detectCutoff(stage.mean, context.sampleRate / FFT_SIZE, minDropDb)
  if (!found) {
    stage.cutoff = null
  } else if (stage.cutoff === null || Math.abs(found.cutoff - stage.cutoff) >= MOVE_MIN_HZ) {
    stage.cutoff = found.cutoff
    moveLayer(stage, found.cutoff)
  }

  stage.layer.gain.setTargetAtTime(getLayerGain(stage), context.currentTime, FADE_SECONDS)
  return getRestoreStatus(stage)
}

/** 곡이 바뀌면 처음부터 다시 잰다. */
export function resetRestore(stage: RestoreStage) {
  stage.sum.fill(0)
  stage.mean.fill(0)
  stage.frames = 0
  stage.settle = SETTLE_TICKS
  stage.cutoff = null
  stage.layer.gain.setTargetAtTime(0, stage.input.context.currentTime, CUT_SECONDS)
}

export function applyRestore(
  stage: RestoreStage,
  strength: RestoreLevel,
  set: (param: AudioParam, value: number) => void,
) {
  stage.strength = strength
  set(stage.gate.gain, strength === 'off' ? 0 : 1)
  set(stage.layer.gain, getLayerGain(stage))
}
