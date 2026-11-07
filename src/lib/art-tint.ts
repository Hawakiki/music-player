/** 표지에서 뽑은 색. 밝기는 테마가 정하므로 색상과 채도만 들고 있는다. */
export interface ArtTint {
  hue: number
  chroma: number
  /** 어두운 테마에서 채도에 곱하는 값. 노랑은 어둡게 깔면 올리브색이 되어 탁해 보인다. */
  darkScale: number
}

const YELLOW_HUE = 100
const YELLOW_WIDTH = 45
const YELLOW_DARK_SCALE = 0.4

const SIZE = 24
const HUE_BINS = 24
const MIN_CHROMA = 0.03
/** 색이 있는 칸이 이보다 적으면 무채색 표지로 본다. 작은 로고 하나가 배경색을 정하지 않게 한다. */
const MIN_COLORED_SHARE = 0.08

const LINEAR = Array.from({ length: 256 }, (_, index) => {
  const value = index / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
})

function toOklab(red: number, green: number, blue: number) {
  const r = LINEAR[red]
  const g = LINEAR[green]
  const b = LINEAR[blue]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ] as const
}

function getDarkScale(hue: number) {
  const distance = Math.abs(((hue - YELLOW_HUE + 540) % 360) - 180)
  const yellow = Math.max(0, 1 - distance / YELLOW_WIDTH)
  return 1 - yellow * (1 - YELLOW_DARK_SCALE)
}

/**
 * 색상 분포에서 가장 넓은 덩어리를 고른다. 평균을 내면 여러 색이 섞여 회색이 된다.
 * 채도로 가중하면 작고 진한 부분이 넓은 배경을 이긴다. 파란 배경 위의 노란 카드가 노랑으로 나왔다.
 * 무채색 표지는 null이다. 회색을 깔면 색이 아니라 얼룩처럼 보인다.
 */
export function pickTint(pixels: Uint8ClampedArray): ArtTint | null {
  const count = new Float64Array(HUE_BINS)
  const sumA = new Float64Array(HUE_BINS)
  const sumB = new Float64Array(HUE_BINS)
  const sumChroma = new Float64Array(HUE_BINS)
  let total = 0

  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue
    total += 1
    const [lightness, a, b] = toOklab(pixels[index], pixels[index + 1], pixels[index + 2])
    const chroma = Math.hypot(a, b)
    if (chroma < MIN_CHROMA || lightness < 0.2 || lightness > 0.96) continue

    const angle = (Math.atan2(b, a) / (2 * Math.PI) + 1) % 1
    const bin = Math.floor(angle * HUE_BINS) % HUE_BINS
    count[bin] += 1
    sumA[bin] += a
    sumB[bin] += b
    sumChroma[bin] += chroma
  }

  let best = 0
  let bestScore = -1
  for (let bin = 0; bin < HUE_BINS; bin += 1) {
    const score = count[(bin + HUE_BINS - 1) % HUE_BINS] + count[bin] + count[(bin + 1) % HUE_BINS]
    if (score > bestScore) {
      bestScore = score
      best = bin
    }
  }

  let a = 0
  let b = 0
  let chroma = 0
  let colored = 0
  for (const offset of [-1, 0, 1]) {
    const bin = (best + offset + HUE_BINS) % HUE_BINS
    a += sumA[bin]
    b += sumB[bin]
    chroma += sumChroma[bin]
    colored += count[bin]
  }

  if (total === 0 || colored / total < MIN_COLORED_SHARE) return null
  const hue = Math.round(((Math.atan2(b, a) * 180) / Math.PI + 360) % 360)
  const mean = chroma / colored
  return { hue, chroma: Number(mean.toFixed(3)), darkScale: Number(getDarkScale(hue).toFixed(2)) }
}

export async function measureTint(image: Blob) {
  const bitmap = await createImageBitmap(image, { resizeWidth: SIZE, resizeHeight: SIZE, resizeQuality: 'medium' })
  const canvas = new OffscreenCanvas(SIZE, SIZE)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    bitmap.close()
    return null
  }
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return pickTint(context.getImageData(0, 0, SIZE, SIZE).data)
}
