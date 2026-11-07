const BLOCK_SECONDS = 0.1
/** 순간 음량은 최근 400ms의 평균이다. */
const MOMENTARY_BLOCKS = 4
const LOUDNESS_OFFSET_DB = -0.691
const SILENT_POWER = 1e-9

interface Coefficients {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

interface FilterState {
  x1: number
  x2: number
  y1: number
  y2: number
}

/** ITU-R BS.1770의 K 가중치 첫 단계. 머리가 소리를 받는 영향을 흉내 낸다. */
function getShelf(sampleRate: number): Coefficients {
  const gainDb = 3.999843853973347
  const q = 0.7071752369554196
  const k = Math.tan((Math.PI * 1681.974450955533) / sampleRate)
  const high = 10 ** (gainDb / 20)
  const band = high ** 0.4996667741545416
  const a0 = 1 + k / q + k * k

  return {
    b0: (high + (band * k) / q + k * k) / a0,
    b1: (2 * (k * k - high)) / a0,
    b2: (high - (band * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  }
}

/** K 가중치 둘째 단계. 저역을 덜 센다. */
function getHighpass(sampleRate: number): Coefficients {
  const q = 0.5003270373238773
  const k = Math.tan((Math.PI * 38.13547087602444) / sampleRate)
  const a0 = 1 + k / q + k * k

  return { b0: 1, b1: -2, b2: 1, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / q + k * k) / a0 }
}

function createState(): FilterState {
  return { x1: 0, x2: 0, y1: 0, y2: 0 }
}

function filter(input: number, { b0, b1, b2, a1, a2 }: Coefficients, state: FilterState) {
  const output = b0 * input + b1 * state.x1 + b2 * state.x2 - a1 * state.y1 - a2 * state.y2
  state.x2 = state.x1
  state.x1 = input
  state.y2 = state.y1
  state.y1 = output
  return output
}

export function createLoudnessMeter(sampleRate: number) {
  const shelf = getShelf(sampleRate)
  const highpass = getHighpass(sampleRate)
  const channels = [
    [createState(), createState()],
    [createState(), createState()],
  ]
  const blockSize = Math.round(sampleRate * BLOCK_SECONDS)
  const blocks: number[] = []
  let sum = 0
  let count = 0

  const weigh = (sample: number, [first, second]: FilterState[]) => filter(filter(sample, shelf, first), highpass, second)

  return {
    add(left: Float32Array, right: Float32Array, from: number, to: number) {
      for (let index = from; index < to; index += 1) {
        sum += weigh(left[index], channels[0]) ** 2 + weigh(right[index], channels[1]) ** 2
        count += 1

        if (count === blockSize) {
          blocks.push(sum / count)
          if (blocks.length > MOMENTARY_BLOCKS) blocks.shift()
          sum = 0
          count = 0
        }
      }
    },
    /** 순간 음량(LUFS). 아직 모자라거나 소리가 없으면 null이다. */
    getMomentary() {
      if (blocks.length < MOMENTARY_BLOCKS) return null

      const power = blocks.reduce((total, block) => total + block, 0) / blocks.length
      return power < SILENT_POWER ? null : LOUDNESS_OFFSET_DB + 10 * Math.log10(power)
    },
  }
}
