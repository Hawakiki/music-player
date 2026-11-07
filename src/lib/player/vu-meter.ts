/** 눈금의 끝. 바늘은 전압에 비례해서 움직이므로 이 값의 전압이 위치 1이다. */
const FULL_SCALE_VU = 3
/** VU는 정류 평균을 재지만 눈금은 사인파의 실효값 기준이다. */
const SINE_FORM_FACTOR = Math.PI / (2 * Math.SQRT2)

/** 규격: 300ms에 99%까지 오르고 1~1.5% 넘어간다. 임계 감쇠면 넘어가지 않으므로 그보다 살짝 덜 감쇠한다. */
const NEEDLE_DAMPING = 0.81
const NEEDLE_FREQUENCY = 13.4
const NEEDLE_STEP_SECONDS = 1 / 480
const NEEDLE_MIN = -0.01
const NEEDLE_MAX = 1.06
const NEEDLE_REST = 0.002

/** 출력 버퍼 두 개 크기다. 새 덩어리의 앞부분을 그릴 때도 창을 채울 앞 덩어리가 있어야 한다. */
export const METER_WINDOW = 16384
export const VU_WINDOW = 2048

export const VU_MARKS = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3]

export interface MeterTap {
  input: GainNode
  left: AnalyserNode
  right: AnalyserNode
}

export interface Needle {
  position: number
  velocity: number
}

export function vuToPosition(vu: number) {
  return 10 ** ((vu - FULL_SCALE_VU) / 20)
}

/** 소리에 영향을 주지 않도록 끝을 어디에도 잇지 않는다. */
export function createMeterTap(context: BaseAudioContext): MeterTap {
  const input = context.createGain()
  input.channelCount = 2
  input.channelCountMode = 'explicit'
  input.channelInterpretation = 'speakers'

  const createChannel = () => {
    const analyser = context.createAnalyser()
    analyser.fftSize = METER_WINDOW
    return analyser
  }
  const left = createChannel()
  const right = createChannel()

  const splitter = context.createChannelSplitter(2)
  input.connect(splitter)
  splitter.connect(left, 0)
  splitter.connect(right, 1)

  return { input, left, right }
}

export function getAverageLevel(samples: Float32Array) {
  let sum = 0
  for (const sample of samples) sum += Math.abs(sample)
  return (sum / samples.length) * SINE_FORM_FACTOR
}

/** 0 VU로 정한 크기(dBFS)를 기준으로 신호 크기를 바늘 위치로 바꾼다. */
export function getNeedleTarget(average: number, referenceDb: number) {
  return average / 10 ** ((referenceDb + FULL_SCALE_VU) / 20)
}

/** 마지막 조각은 남은 시간만큼만 움직인다. 올림하면 주사율이 높은 화면에서 바늘이 빨라진다. */
export function moveNeedle(needle: Needle, target: number, seconds: number) {
  for (let left = seconds; left > 0; left -= NEEDLE_STEP_SECONDS) {
    const step = Math.min(left, NEEDLE_STEP_SECONDS)
    const force =
      NEEDLE_FREQUENCY ** 2 * (target - needle.position) - 2 * NEEDLE_DAMPING * NEEDLE_FREQUENCY * needle.velocity
    needle.velocity += force * step
    needle.position += needle.velocity * step

    if (needle.position < NEEDLE_MIN || needle.position > NEEDLE_MAX) {
      needle.position = Math.min(Math.max(needle.position, NEEDLE_MIN), NEEDLE_MAX)
      needle.velocity = 0
    }
  }
}

export function isNeedleResting({ position, velocity }: Needle) {
  return Math.abs(position) < NEEDLE_REST && Math.abs(velocity) < NEEDLE_REST
}
