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

export type CrossfeedLevel = 'off' | keyof typeof CROSSFEED_LEVELS

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
  limiter: boolean
  /** 음량 평준화로 지금 곡에 줄 값. */
  trackGainDb: number
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
  mix: { leftToLeft: GainNode; leftToRight: GainNode; rightToLeft: GainNode; rightToRight: GainNode }
  crossfeed: { left: CrossfeedSide; right: CrossfeedSide }
  leftOut: GainNode
  rightOut: GainNode
  merger: ChannelMergerNode
  limiter: DynamicsCompressorNode
  makeup: GainNode
}

let graph: SoundGraph | null = null
let settings: SoundSettings | null = null
let currentRoute: string | null = null
let probedSampleRate: number | null = null

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

  const splitter = context.createChannelSplitter(2)
  previous.connect(splitter)

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
    mix,
    crossfeed,
    leftOut,
    rightOut,
    merger,
    limiter,
    makeup,
  }
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

  set(current.leftOut.gain, next.balance > 0 ? 1 - next.balance : 1)
  set(current.rightOut.gain, next.balance < 0 ? 1 + next.balance : 1)
}

/** 연결을 바꾸면 잡음이 날 수 있어서 경로가 달라질 때만 다시 잇는다. */
function applyRoute(current: SoundGraph, next: SoundSettings) {
  const processing = isProcessing(next)
  const route = `${processing}:${processing && next.limiter}`
  if (route === currentRoute) return
  currentRoute = route

  const { context, source, input, merger, limiter, makeup } = current
  source.disconnect()
  merger.disconnect()
  makeup.disconnect()

  if (!processing) {
    source.connect(context.destination)
    return
  }

  source.connect(input)
  if (next.limiter) {
    merger.connect(limiter)
    makeup.connect(context.destination)
  } else {
    merger.connect(context.destination)
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
