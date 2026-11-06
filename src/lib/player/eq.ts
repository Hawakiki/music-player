import { audio } from './audio'

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
export const EQ_RANGE = 12

const BAND_Q = 1.4
const SMOOTHING_SECONDS = 0.02

export interface EqValues {
  preamp: number
  gains: number[]
}

export interface EqSettings extends EqValues {
  enabled: boolean
}

interface EqGraph {
  context: AudioContext
  source: MediaElementAudioSourceNode
  preamp: GainNode
  filters: BiquadFilterNode[]
}

let graph: EqGraph | null = null
let settings: EqSettings | null = null
let probedSampleRate: number | null = null

function createGraph(): EqGraph {
  const context = new AudioContext({ latencyHint: 'playback' })
  const source = context.createMediaElementSource(audio)
  const preamp = context.createGain()
  const filters = EQ_BANDS.map((frequency) => {
    const filter = context.createBiquadFilter()
    filter.type = 'peaking'
    filter.frequency.value = frequency
    filter.Q.value = BAND_Q
    return filter
  })

  let previous: AudioNode = preamp
  for (const filter of filters) {
    previous.connect(filter)
    previous = filter
  }

  return { context, source, preamp, filters }
}

function applySettings({ context, source, preamp, filters }: EqGraph, next: EqSettings) {
  const now = context.currentTime
  preamp.gain.setTargetAtTime(10 ** (next.preamp / 20), now, SMOOTHING_SECONDS)
  filters.forEach((filter, index) => filter.gain.setTargetAtTime(next.gains[index], now, SMOOTHING_SECONDS))

  // 끄면 필터를 거치지 않고 바로 내보낸다.
  source.disconnect()
  filters[filters.length - 1].disconnect()
  if (next.enabled) {
    source.connect(preamp)
    filters[filters.length - 1].connect(context.destination)
  } else {
    source.connect(context.destination)
  }
}

/** 시작할 때 설정만 기억한다. 그래프는 재생을 누른 뒤에 만들어야 자동 재생 정책에 막히지 않는다. */
export function configureEq(next: EqSettings) {
  settings = next
}

/**
 * 한 번 그래프로 연결한 audio 요소는 되돌릴 수 없다. 그래서 EQ를 쓰지 않는 사람은
 * 끝까지 그래프 없이 재생하고, 켠 뒤에는 새로고침 전까지 그래프를 유지한다.
 */
export function updateEq(next: EqSettings) {
  settings = next
  if (!graph && !next.enabled) return

  graph ??= createGraph()
  applySettings(graph, next)
  void graph.context.resume()
}

export function prepareEqForPlayback() {
  if (!graph && settings?.enabled) updateEq(settings)
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
