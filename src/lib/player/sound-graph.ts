import { audio } from './audio'

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
export const EQ_RANGE = 12
export const TONE_RANGE = 12

const BAND_Q = 1.4
const BASS_FREQUENCY = 120
const TREBLE_FREQUENCY = 6000
const SMOOTHING_SECONDS = 0.02

const CROSSFEED_DELAY_SECONDS = 0.0003
const CROSSFEED_LEVELS = {
  light: { cutoff: 650, feedDb: -9.5 },
  medium: { cutoff: 700, feedDb: -6 },
  strong: { cutoff: 700, feedDb: -4.5 },
}

const LIMITER_THRESHOLD_DB = -1
const LIMITER_RATIO = 20

const TUBE_CURVE_SIZE = 4097
const TUBE_SLOPE = 1.6
const TUBE_BIAS = 0.3
const TUBE_MIN_DRIVE = 0.02
const TUBE_MAX_DRIVE = 0.65
const TUBE_DC_BLOCK_FREQUENCY = 10

const VINYL_LOOP_SECONDS = 12
const VINYL_POPS_PER_SECOND = 5
const VINYL_HIGH_CUT_FREQUENCY = 9000
const VINYL_WOW_FREQUENCY = 0.55
const VINYL_FLUTTER_FREQUENCY = 6.1
const VINYL_BASE_DELAY_SECONDS = 0.004
const VINYL_LEVELS = {
  light: { noiseDb: -62, wow: 0.00015, flutter: 0.00003, highCutDb: -1.5 },
  medium: { noiseDb: -56, wow: 0.0003, flutter: 0.00006, highCutDb: -3 },
  strong: { noiseDb: -50, wow: 0.0005, flutter: 0.0001, highCutDb: -5 },
}

const PHASE_Q = 0.7
const PHASE_FREQUENCIES = { light: 60, medium: 120, strong: 240 }

export type CrossfeedLevel = 'off' | keyof typeof CROSSFEED_LEVELS
export type VinylLevel = 'off' | keyof typeof VINYL_LEVELS
export type PhaseLevel = 'off' | keyof typeof PHASE_FREQUENCIES

export interface EqValues {
  preamp: number
  gains: number[]
}

export interface SoundSettings extends EqValues {
  eqEnabled: boolean
  bass: number
  treble: number
  /** -1은 왼쪽 끝, 1은 오른쪽 끝. */
  balance: number
  /** 1이 원래 폭, 0이 모노. */
  width: number
  mono: boolean
  crossfeed: CrossfeedLevel
  /** 0이면 꺼짐, 1이 최대. */
  tube: number
  vinyl: VinylLevel
  phase: PhaseLevel
  limiter: boolean
  /** 음량 평준화로 지금 곡에 줄 값. */
  trackGainDb: number
  /** 바이닐 잡음은 음악과 따로 나오므로 재생 상태와 음량을 따라가야 한다. */
  playing: boolean
  volume: number
  /** 원음 듣기. 켜면 모든 처리를 건너뛴다. */
  direct: boolean
}

interface CrossfeedSide {
  shelf: BiquadFilterNode
  direct: GainNode
  lowpass: BiquadFilterNode
  feed: GainNode
}

interface SoundGraph {
  context: AudioContext
  source: MediaElementAudioSourceNode
  input: GainNode
  preamp: GainNode
  bands: BiquadFilterNode[]
  bass: BiquadFilterNode
  treble: BiquadFilterNode
  tube: { dry: GainNode; wet: GainNode; drive: GainNode; level: GainNode }
  phase: BiquadFilterNode
  phaseSwitch: { off: GainNode; on: GainNode }
  vinyl: { highCut: BiquadFilterNode; wow: GainNode; flutter: GainNode; noise: GainNode }
  mix: { leftToLeft: GainNode; leftToRight: GainNode; rightToLeft: GainNode; rightToRight: GainNode }
  crossfeed: { left: CrossfeedSide; right: CrossfeedSide }
  leftOut: GainNode
  rightOut: GainNode
  output: GainNode
  limiter: DynamicsCompressorNode
  makeup: GainNode
}

let graph: SoundGraph | null = null
let settings: SoundSettings | null = null
let currentRoute: string | null = null
let probedSampleRate: number | null = null
let vinylNoiseStarted = false

function dbToGain(db: number) {
  return 10 ** (db / 20)
}

/** DynamicsCompressorNode가 자동으로 올리는 음량. 되돌려야 켜기만 해도 소리가 커지지 않는다. */
function getLimiterMakeup() {
  const threshold = dbToGain(LIMITER_THRESHOLD_DB)
  const fullRange = threshold * (1 / threshold) ** (1 / LIMITER_RATIO)
  return (1 / fullRange) ** 0.6
}

export function isProcessing(next: SoundSettings) {
  if (next.direct) return false

  return (
    next.eqEnabled ||
    next.bass !== 0 ||
    next.treble !== 0 ||
    next.balance !== 0 ||
    next.width !== 1 ||
    next.mono ||
    next.crossfeed !== 'off' ||
    next.tube > 0 ||
    next.vinyl !== 'off' ||
    next.phase !== 'off' ||
    next.trackGainDb !== 0
  )
}

function createShelf(context: AudioContext, type: BiquadFilterType, frequency: number) {
  const filter = context.createBiquadFilter()
  filter.type = type
  filter.frequency.value = frequency
  return filter
}

function createCrossfeedSide(context: AudioContext, bus: GainNode, own: GainNode, other: GainNode): CrossfeedSide {
  const shelf = createShelf(context, 'highshelf', CROSSFEED_LEVELS.medium.cutoff)
  const direct = context.createGain()
  bus.connect(shelf).connect(direct).connect(own)

  const lowpass = createShelf(context, 'lowpass', CROSSFEED_LEVELS.medium.cutoff)
  const delay = context.createDelay(0.01)
  delay.delayTime.value = CROSSFEED_DELAY_SECONDS
  const feed = context.createGain()
  feed.gain.value = 0
  bus.connect(lowpass).connect(delay).connect(feed).connect(other)

  return { shelf, direct, lowpass, feed }
}

/** 작은 소리는 그대로 두고 큰 소리만 비대칭으로 눌러서 짝수 배음을 만든다. */
function createTubeCurve() {
  const curve = new Float32Array(TUBE_CURVE_SIZE)
  const offset = Math.tanh(TUBE_BIAS)
  const smallSignalGain = TUBE_SLOPE * (1 - offset ** 2)

  for (let i = 0; i < TUBE_CURVE_SIZE; i += 1) {
    const x = (i / (TUBE_CURVE_SIZE - 1)) * 2 - 1
    curve[i] = (Math.tanh(TUBE_SLOPE * x + TUBE_BIAS) - offset) / smallSignalGain
  }
  return curve
}

function createRandom(seed: number) {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

/** 표면 잡음, 저역 럼블, 틱 소리를 합성한다. 잔잡음의 실효값이 1이 되도록 맞춘다. */
function createVinylNoise(context: AudioContext) {
  const { sampleRate } = context
  const length = sampleRate * VINYL_LOOP_SECONDS
  const buffer = context.createBuffer(2, length, sampleRate)

  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel)
    const random = createRandom(channel + 1)
    let hiss = 0
    let rumble = 0
    let power = 0

    for (let i = 0; i < length; i += 1) {
      const white = random() * 2 - 1
      hiss += (white - hiss) * 0.1
      rumble += (white - rumble) * 0.003
      data[i] = hiss + rumble * 2
      power += data[i] ** 2
    }

    const scale = 1 / Math.sqrt(power / length)
    for (let i = 0; i < length; i += 1) data[i] *= scale

    for (let pop = 0; pop < VINYL_LOOP_SECONDS * VINYL_POPS_PER_SECOND; pop += 1) {
      const start = Math.floor(random() * length)
      const size = Math.floor(sampleRate * (0.0005 + random() * 0.002))
      const height = (4 + random() ** 3 * 40) * (random() < 0.5 ? -1 : 1)
      for (let i = 0; i < size && start + i < length; i += 1) {
        data[start + i] += height * (1 - i / size) ** 2 * (random() * 1.2 - 0.1)
      }
    }
  }
  return buffer
}

function createGraph(): SoundGraph {
  const context = new AudioContext({ latencyHint: 'playback' })
  const source = context.createMediaElementSource(audio)

  // 좌우를 나누기 전에 스테레오로 맞춘다. 모노 파일은 그대로 나누면 한쪽이 무음이 된다.
  const input = context.createGain()
  input.channelCount = 2
  input.channelCountMode = 'explicit'
  input.channelInterpretation = 'speakers'

  const preamp = context.createGain()
  const bands = EQ_BANDS.map((frequency) => {
    const filter = createShelf(context, 'peaking', frequency)
    filter.Q.value = BAND_Q
    return filter
  })
  const bass = createShelf(context, 'lowshelf', BASS_FREQUENCY)
  const treble = createShelf(context, 'highshelf', TREBLE_FREQUENCY)

  let previous: AudioNode = input
  for (const node of [preamp, ...bands, bass, treble]) {
    previous.connect(node)
    previous = node
  }

  // 원음과 왜곡음을 섞으면 왜곡 쪽 지연으로 고역이 패인다. 그래서 둘 중 하나만 지나게 한다.
  const tubeDry = context.createGain()
  const tubeWet = context.createGain()
  tubeWet.gain.value = 0
  const tubeDrive = context.createGain()
  const shaper = context.createWaveShaper()
  shaper.curve = createTubeCurve()
  shaper.oversample = '4x'
  const tubeLevel = context.createGain()
  const dcBlock = createShelf(context, 'highpass', TUBE_DC_BLOCK_FREQUENCY)
  const afterTube = context.createGain()
  previous.connect(tubeDry).connect(afterTube)
  previous.connect(tubeDrive).connect(shaper).connect(tubeLevel).connect(dcBlock).connect(tubeWet).connect(afterTube)

  const phase = createShelf(context, 'allpass', PHASE_FREQUENCIES.medium)
  phase.Q.value = PHASE_Q
  const phaseOff = context.createGain()
  const phaseOn = context.createGain()
  phaseOn.gain.value = 0
  const afterPhase = context.createGain()
  afterTube.connect(phaseOff).connect(afterPhase)
  afterTube.connect(phase).connect(phaseOn).connect(afterPhase)

  const highCut = createShelf(context, 'highshelf', VINYL_HIGH_CUT_FREQUENCY)
  const wobble = context.createDelay(0.02)
  wobble.delayTime.value = VINYL_BASE_DELAY_SECONDS
  const wow = context.createGain()
  wow.gain.value = 0
  const flutter = context.createGain()
  flutter.gain.value = 0
  for (const [frequency, depth] of [[VINYL_WOW_FREQUENCY, wow], [VINYL_FLUTTER_FREQUENCY, flutter]] as const) {
    const oscillator = context.createOscillator()
    oscillator.frequency.value = frequency
    oscillator.connect(depth).connect(wobble.delayTime)
    oscillator.start()
  }
  afterPhase.connect(highCut).connect(wobble)

  const splitter = context.createChannelSplitter(2)
  wobble.connect(splitter)

  const leftBus = context.createGain()
  const rightBus = context.createGain()
  const mix = {
    leftToLeft: context.createGain(),
    leftToRight: context.createGain(),
    rightToLeft: context.createGain(),
    rightToRight: context.createGain(),
  }
  splitter.connect(mix.leftToLeft, 0).connect(leftBus)
  splitter.connect(mix.leftToRight, 0).connect(rightBus)
  splitter.connect(mix.rightToLeft, 1).connect(leftBus)
  splitter.connect(mix.rightToRight, 1).connect(rightBus)

  const leftOut = context.createGain()
  const rightOut = context.createGain()
  const crossfeed = {
    left: createCrossfeedSide(context, leftBus, leftOut, rightOut),
    right: createCrossfeedSide(context, rightBus, rightOut, leftOut),
  }

  const merger = context.createChannelMerger(2)
  leftOut.connect(merger, 0, 0)
  rightOut.connect(merger, 0, 1)

  const output = context.createGain()
  merger.connect(output)
  const noise = context.createGain()
  noise.gain.value = 0
  noise.connect(output)

  const limiter = context.createDynamicsCompressor()
  limiter.threshold.value = LIMITER_THRESHOLD_DB
  limiter.knee.value = 0
  limiter.ratio.value = LIMITER_RATIO
  limiter.attack.value = 0.002
  limiter.release.value = 0.1
  const makeup = context.createGain()
  makeup.gain.value = 1 / getLimiterMakeup()
  limiter.connect(makeup)

  return {
    context,
    source,
    input,
    preamp,
    bands,
    bass,
    treble,
    tube: { dry: tubeDry, wet: tubeWet, drive: tubeDrive, level: tubeLevel },
    phase,
    phaseSwitch: { off: phaseOff, on: phaseOn },
    vinyl: { highCut, wow, flutter, noise },
    mix,
    crossfeed,
    leftOut,
    rightOut,
    output,
    limiter,
    makeup,
  }
}

/** 바이닐을 처음 켤 때 한 번만 만든다. */
function startVinylNoise({ context, vinyl }: SoundGraph) {
  if (vinylNoiseStarted) return
  vinylNoiseStarted = true

  const source = context.createBufferSource()
  source.buffer = createVinylNoise(context)
  source.loop = true
  source.connect(vinyl.noise)
  source.start()
}

function applyCrossfeedSide(side: CrossfeedSide, level: CrossfeedLevel, set: (param: AudioParam, value: number) => void) {
  if (level === 'off') {
    set(side.feed.gain, 0)
    set(side.direct.gain, 1)
    set(side.shelf.gain, 0)
    return
  }

  // 저역은 직접 소리와 건너온 소리의 합이 1이 되게 줄이고, 고역은 줄어든 만큼 되돌린다.
  const { cutoff, feedDb } = CROSSFEED_LEVELS[level]
  const feed = dbToGain(feedDb)
  const direct = 1 / (1 + feed)

  side.shelf.frequency.value = cutoff
  side.lowpass.frequency.value = cutoff
  set(side.feed.gain, feed * direct)
  set(side.direct.gain, direct)
  set(side.shelf.gain, -20 * Math.log10(direct))
}

function applyValues(current: SoundGraph, next: SoundSettings) {
  const now = current.context.currentTime
  const set = (param: AudioParam, value: number) => param.setTargetAtTime(value, now, SMOOTHING_SECONDS)

  set(current.input.gain, dbToGain(next.trackGainDb))
  set(current.preamp.gain, next.eqEnabled ? dbToGain(next.preamp) : 1)
  current.bands.forEach((band, index) => set(band.gain, next.eqEnabled ? next.gains[index] : 0))
  set(current.bass.gain, next.bass)
  set(current.treble.gain, next.treble)

  // 폭 1은 그대로, 0은 좌우를 같게, 1보다 크면 반대쪽을 빼서 넓힌다.
  const width = next.mono ? 0 : next.width
  const same = (1 + width) / 2
  const opposite = (1 - width) / 2
  set(current.mix.leftToLeft.gain, same)
  set(current.mix.rightToRight.gain, same)
  set(current.mix.leftToRight.gain, opposite)
  set(current.mix.rightToLeft.gain, opposite)

  applyCrossfeedSide(current.crossfeed.left, next.crossfeed, set)
  applyCrossfeedSide(current.crossfeed.right, next.crossfeed, set)

  // 앞쪽을 곱게 쓸 수 있도록 곡선으로 올린다.
  const drive = TUBE_MIN_DRIVE + next.tube ** 1.5 * (TUBE_MAX_DRIVE - TUBE_MIN_DRIVE)
  set(current.tube.drive.gain, drive)
  set(current.tube.level.gain, 1 / drive)
  set(current.tube.wet.gain, next.tube > 0 ? 1 : 0)
  set(current.tube.dry.gain, next.tube > 0 ? 0 : 1)

  if (next.phase !== 'off') current.phase.frequency.value = PHASE_FREQUENCIES[next.phase]
  set(current.phaseSwitch.on.gain, next.phase === 'off' ? 0 : 1)
  set(current.phaseSwitch.off.gain, next.phase === 'off' ? 1 : 0)

  const vinyl = next.vinyl === 'off' ? null : VINYL_LEVELS[next.vinyl]
  if (vinyl) startVinylNoise(current)
  set(current.vinyl.highCut.gain, vinyl?.highCutDb ?? 0)
  set(current.vinyl.wow.gain, vinyl?.wow ?? 0)
  set(current.vinyl.flutter.gain, vinyl?.flutter ?? 0)
  set(current.vinyl.noise.gain, vinyl && next.playing && !next.direct ? dbToGain(vinyl.noiseDb) * next.volume : 0)

  set(current.leftOut.gain, next.balance > 0 ? 1 - next.balance : 1)
  set(current.rightOut.gain, next.balance < 0 ? 1 + next.balance : 1)
}

/** 연결을 바꾸면 잡음이 날 수 있어서 경로가 달라질 때만 다시 잇는다. */
function applyRoute(current: SoundGraph, next: SoundSettings) {
  const processing = isProcessing(next)
  const route = `${processing}:${processing && next.limiter}`
  if (route === currentRoute) return
  currentRoute = route

  const { context, source, input, output, limiter, makeup } = current
  source.disconnect()
  output.disconnect()
  makeup.disconnect()

  if (!processing) {
    source.connect(context.destination)
    return
  }

  source.connect(input)
  if (next.limiter) {
    output.connect(limiter)
    makeup.connect(context.destination)
  } else {
    output.connect(context.destination)
  }
}

/**
 * 한 번 그래프로 연결한 audio 요소는 되돌릴 수 없다. 그래서 처리가 하나도 없는 사람은
 * 끝까지 그래프 없이 재생하고, 켠 뒤에는 새로고침 전까지 그래프를 유지한다.
 */
export function updateSound(next: SoundSettings) {
  settings = next

  if (!graph) {
    // 첫 클릭 전에 만들면 자동 재생 정책에 막힌다. 그때는 재생을 누를 때 만든다.
    if (!isProcessing(next) || navigator.userActivation?.hasBeenActive === false) return
    graph = createGraph()
  }

  applyValues(graph, next)
  applyRoute(graph, next)
  void graph.context.resume()
}

export function prepareSoundForPlayback() {
  if (settings) updateSound(settings)
  void graph?.context.resume()
}

export function getOutputSampleRate() {
  if (graph) return graph.context.sampleRate

  if (probedSampleRate === null) {
    const probe = new AudioContext()
    probedSampleRate = probe.sampleRate
    void probe.close()
  }
  return probedSampleRate
}
