export const SPECTRUM_SIZE = 4096
export const COLUMN_SECONDS = 1 / 40

const MIN_HZ = 30
const MAX_HZ = 22000
const FLOOR_DB = -105
const CEILING_DB = -25
const SILENCE = 1e-7

/** 포인트 파랑 하나의 명도 변화다. 큰 소리만 밝아져서 눈이 편하다. */
const COLOR_STOPS: [number, [number, number, number]][] = [
  [0, [20, 23, 26]],
  [0.35, [43, 66, 96]],
  [0.65, [95, 134, 181]],
  [0.85, [169, 196, 230]],
  [1, [238, 243, 249]],
]

export function getFrequencyPosition(hz: number) {
  return Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ)
}

export function createColorTable() {
  const table = new Uint8ClampedArray(256 * 3)

  for (let level = 0; level < 256; level += 1) {
    const value = level / 255
    const upper = COLOR_STOPS.findIndex(([stop]) => stop >= value)
    const [high, highColor] = COLOR_STOPS[upper]
    const [low, lowColor] = COLOR_STOPS[Math.max(upper - 1, 0)]
    const mix = high === low ? 0 : (value - low) / (high - low)
    for (let channel = 0; channel < 3; channel += 1) {
      table[level * 3 + channel] = lowColor[channel] + (highColor[channel] - lowColor[channel]) * mix
    }
  }
  return table
}

/** 위가 높은 소리다. 각 줄이 맡는 FFT 구간을 미리 구해 둔다. */
export function createRowBins(height: number, binHz: number, binCount: number) {
  const bins = new Uint16Array(height * 2)

  for (let row = 0; row < height; row += 1) {
    const hz = (position: number) => MIN_HZ * (MAX_HZ / MIN_HZ) ** position
    const low = hz(1 - (row + 1) / height) / binHz
    const high = hz(1 - row / height) / binHz
    const first = Math.min(Math.round(low), binCount - 1)
    bins[row * 2] = first
    bins[row * 2 + 1] = Math.max(first, Math.min(Math.round(high), binCount - 1))
  }
  return bins
}

/** 좌우를 따로 재서 파워를 더한다. 모노로 합치면 역위상 소리가 지워져서 안 보인다. */
export function writeColumn(
  left: Float32Array,
  right: Float32Array,
  rowBins: Uint16Array,
  colors: Uint8ClampedArray,
  pixels: Uint8ClampedArray,
) {
  const rows = rowBins.length / 2

  for (let row = 0; row < rows; row += 1) {
    let loudest = -Infinity
    for (let bin = rowBins[row * 2]; bin <= rowBins[row * 2 + 1]; bin += 1) {
      const power = 10 ** (left[bin] / 10) + 10 ** (right[bin] / 10)
      if (power > loudest) loudest = power
    }

    const db = 10 * Math.log10(loudest / 2 + 1e-30)
    const level = Math.round(Math.min(Math.max((db - FLOOR_DB) / (CEILING_DB - FLOOR_DB), 0), 1) * 255)
    pixels[row * 4] = colors[level * 3]
    pixels[row * 4 + 1] = colors[level * 3 + 1]
    pixels[row * 4 + 2] = colors[level * 3 + 2]
    pixels[row * 4 + 3] = 255
  }
}

/** 분석기는 덩어리의 마지막만 보여 줘서, 시간에 맞춰 풀어 그리려면 직접 계산해야 한다. 값은 분석기와 같은 dB다. */
export function createSpectrumReader() {
  const size = SPECTRUM_SIZE
  const real = new Float64Array(size)
  const imaginary = new Float64Array(size)
  const blackman = Float64Array.from({ length: size }, (_, index) => {
    const angle = (2 * Math.PI * index) / size
    return 0.42 - 0.5 * Math.cos(angle) + 0.08 * Math.cos(2 * angle)
  })
  const cosines = Float64Array.from({ length: size / 2 }, (_, index) => Math.cos((-2 * Math.PI * index) / size))
  const sines = Float64Array.from({ length: size / 2 }, (_, index) => Math.sin((-2 * Math.PI * index) / size))
  const order = new Uint16Array(size)
  for (let index = 1; index < size; index += 1) {
    order[index] = (order[index >> 1] >> 1) | (index & 1 ? size >> 1 : 0)
  }

  return (samples: Float32Array, output: Float32Array) => {
    for (let index = 0; index < size; index += 1) {
      real[order[index]] = samples[index] * blackman[index]
      imaginary[index] = 0
    }

    for (let span = 2; span <= size; span *= 2) {
      const half = span / 2
      const stride = size / span
      for (let start = 0; start < size; start += span) {
        for (let offset = 0; offset < half; offset += 1) {
          const cosine = cosines[offset * stride]
          const sine = sines[offset * stride]
          const low = start + offset
          const high = low + half
          const realPart = real[high] * cosine - imaginary[high] * sine
          const imaginaryPart = real[high] * sine + imaginary[high] * cosine
          real[high] = real[low] - realPart
          imaginary[high] = imaginary[low] - imaginaryPart
          real[low] += realPart
          imaginary[low] += imaginaryPart
        }
      }
    }

    for (let bin = 0; bin < output.length; bin += 1) {
      output[bin] = 20 * Math.log10(Math.hypot(real[bin], imaginary[bin]) / size + 1e-15)
    }
  }
}

/** 위상은 1이면 같은 소리, 0이면 무관, -1이면 정반대다. 좌우는 -1이 왼쪽 끝이다. 소리가 없으면 null이다. */
export function getStereoStats(left: Float32Array, right: Float32Array) {
  let leftPower = 0
  let rightPower = 0
  let shared = 0

  for (let index = 0; index < left.length; index += 1) {
    leftPower += left[index] ** 2
    rightPower += right[index] ** 2
    shared += left[index] * right[index]
  }

  const total = leftPower + rightPower
  if (total / left.length < SILENCE) return null

  const scale = Math.sqrt(leftPower * rightPower)
  return { correlation: scale > 0 ? shared / scale : 0, balance: (rightPower - leftPower) / total }
}
