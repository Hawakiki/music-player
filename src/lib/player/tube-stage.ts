import { createFilter, dbToGain } from './audio-nodes'

const CURVE_SIZE = 4097
const CURVE_SLOPE = 1.6
const LINEAR_CURVE = new Float32Array([-1, 1])
const DRIVE = 0.4
/** 곡선은 -1에서 1까지만 받는다. 음량을 크게 올려도 원음이 잘리지 않게 줄여서 지나게 한다. */
const CLEAN_HEADROOM = 16

const BASS_CUT_DB = 18
const BASS_CUT_FREQUENCY = 200
const HARMONICS_CUTOFF = 120
/** highpass의 Q는 dB 단위라서 버터워스 값이 0.707이 아니라 -3.01이다. */
const BUTTERWORTH_Q_DB = -3.01

const WARMTH_FREQUENCY = 300
const WARMTH_Q = 0.8
const SOFTEN_FREQUENCY = 7000

/** 실제 앰프의 재현이 아니라 성격을 본뜬 값이다. 음색으로 커진 음량은 trimDb로 되돌린다. */
const TUBE_MODES = {
  triode: { bias: 0.3, warmthDb: 2, softenDb: -2, trimDb: -0.5 },
  ultralinear: { bias: 0.03, warmthDb: 0, softenDb: 0, trimDb: 0 },
}

export type TubeMode = keyof typeof TUBE_MODES

export interface TubeStage {
  input: GainNode
  output: GainNode
  dry: GainNode
  wet: GainNode
  curves: Record<TubeMode, GainNode>
  harmonics: GainNode
  warmth: BiquadFilterNode
  soften: BiquadFilterNode
}

/** 작은 소리는 그대로 두고 큰 소리만 누른다. 치우침이 클수록 짝수 배음이 많아진다. */
function createCurve(bias: number) {
  const curve = new Float32Array(CURVE_SIZE)
  const offset = Math.tanh(bias)
  const smallSignalGain = CURVE_SLOPE * (1 - offset ** 2)

  for (let i = 0; i < CURVE_SIZE; i += 1) {
    const x = (i / (CURVE_SIZE - 1)) * 2 - 1
    curve[i] = (Math.tanh(CURVE_SLOPE * x + bias) - offset) / smallSignalGain
  }
  return curve
}

function createShaper(context: BaseAudioContext, curve: Float32Array<ArrayBuffer>) {
  const shaper = context.createWaveShaper()
  shaper.curve = curve
  shaper.oversample = '4x'
  return shaper
}

function createGain(context: BaseAudioContext, value: number) {
  const gain = context.createGain()
  gain.gain.value = value
  return gain
}

function createHarmonicsFilter(context: BaseAudioContext) {
  const filter = createFilter(context, 'highpass', HARMONICS_CUTOFF)
  filter.Q.value = BUTTERWORTH_Q_DB
  return filter
}

/**
 * 곡선을 지난 소리에서 곡선에 넣은 소리를 빼면 곡선이 더한 왜곡만 남는다.
 * 그 왜곡의 저역을 없애고 원음에 더한다. 저역까지 두면 곡에 없던 저음이 생겨서 윙윙거린다.
 */
export function createTubeStage(context: BaseAudioContext): TubeStage {
  const input = context.createGain()
  const output = context.createGain()

  const dry = context.createGain()
  input.connect(dry).connect(output)

  const wet = createGain(context, 0)
  input.connect(wet)

  // 곡선은 오버샘플링 때문에 소리가 늦는다. 원음도 직선 곡선을 지나게 해서 시간을 맞춘다.
  const clean = wet
    .connect(createGain(context, 1 / CLEAN_HEADROOM))
    .connect(createShaper(context, LINEAR_CURVE))
    .connect(createGain(context, CLEAN_HEADROOM))

  // 큰 베이스가 곡선을 밀면 위에 얹힌 보컬까지 찌그러지므로 저역을 줄여서 넣는다.
  const pushed = wet
    .connect(createGain(context, DRIVE))
    .connect(createFilter(context, 'lowshelf', BASS_CUT_FREQUENCY, -BASS_CUT_DB))

  const residual = context.createGain()
  const createCurveGate = (mode: TubeMode) => {
    const gate = createGain(context, mode === 'triode' ? 1 : 0)
    pushed.connect(gate).connect(createShaper(context, createCurve(TUBE_MODES[mode].bias))).connect(residual)
    return gate
  }
  const curves = { triode: createCurveGate('triode'), ultralinear: createCurveGate('ultralinear') }

  clean
    .connect(createGain(context, -DRIVE))
    .connect(createFilter(context, 'lowshelf', BASS_CUT_FREQUENCY, -BASS_CUT_DB))
    .connect(residual)

  const harmonics = createGain(context, 0)
  const mixed = context.createGain()
  clean.connect(mixed)
  residual
    .connect(harmonics)
    .connect(createHarmonicsFilter(context))
    .connect(createHarmonicsFilter(context))
    .connect(mixed)

  const warmth = createFilter(context, 'peaking', WARMTH_FREQUENCY)
  warmth.Q.value = WARMTH_Q
  const soften = createFilter(context, 'highshelf', SOFTEN_FREQUENCY)
  mixed.connect(warmth).connect(soften).connect(output)

  return { input, output, dry, wet, curves, harmonics, warmth, soften }
}

export function applyTube(
  stage: TubeStage,
  amount: number,
  mode: TubeMode,
  set: (param: AudioParam, value: number) => void,
) {
  const { warmthDb, softenDb, trimDb } = TUBE_MODES[mode]
  const on = amount > 0

  set(stage.dry.gain, on ? 0 : 1)
  set(stage.wet.gain, on ? dbToGain(trimDb * amount) : 0)
  // 앞쪽을 곱게 쓸 수 있도록 곡선으로 올린다.
  set(stage.harmonics.gain, amount ** 1.5 / DRIVE)
  // 두 곡선의 합이 늘 1이어야 전환 중에도 원음이 새어 나오지 않는다.
  set(stage.curves.triode.gain, mode === 'triode' ? 1 : 0)
  set(stage.curves.ultralinear.gain, mode === 'ultralinear' ? 1 : 0)
  set(stage.warmth.gain, warmthDb * amount)
  set(stage.soften.gain, softenDb * amount)
}
