import { METER_WINDOW, type MeterTap } from './vu-meter'

/**
 * 출력 버퍼가 크면 소리가 덩어리로 만들어져서 분석기 값이 초당 몇 번만 바뀐다.
 * 받은 덩어리를 실제 시간에 맞춰 조금씩 내보내서 화면을 부드럽게 한다.
 * 소리도 그만큼 늦게 나오므로 화면이 들리는 소리와 맞는다.
 */
export interface MeterReader {
  left: Float32Array<ArrayBuffer>
  right: Float32Array<ArrayBuffer>
  nextLeft: Float32Array<ArrayBuffer>
  nextRight: Float32Array<ArrayBuffer>
  probe: Float32Array<ArrayBuffer>
  oldest: number
  receivedAt: number
  cursor: number
  previous: number
}

export function createMeterReader(): MeterReader {
  return {
    left: new Float32Array(METER_WINDOW),
    right: new Float32Array(METER_WINDOW),
    nextLeft: new Float32Array(METER_WINDOW),
    nextRight: new Float32Array(METER_WINDOW),
    probe: new Float32Array(1),
    oldest: Number.NaN,
    receivedAt: 0,
    cursor: METER_WINDOW,
    previous: METER_WINDOW,
  }
}

/** 좌우를 차례로 읽는 사이에 오디오가 진행하면 두 창이 어긋나서 위상이 틀어진다. 그때는 다음 프레임에 다시 읽는다. */
function readStereo({ nextLeft, nextRight }: MeterReader, tap: MeterTap) {
  tap.left.getFloatTimeDomainData(nextLeft)
  tap.right.getFloatTimeDomainData(nextRight)

  const newest = nextLeft[METER_WINDOW - 1]
  tap.left.getFloatTimeDomainData(nextLeft)
  return nextLeft[METER_WINDOW - 1] === newest
}

export function advanceMeter(reader: MeterReader, tap: MeterTap, seconds: number, now: number) {
  const { sampleRate } = tap.input.context
  reader.previous = reader.cursor
  reader.cursor = Math.min(reader.cursor + seconds * sampleRate, METER_WINDOW)

  // 가장 오래된 샘플 하나만 읽어서 새 덩어리가 왔는지 본다.
  tap.left.getFloatTimeDomainData(reader.probe)
  if (reader.probe[0] === reader.oldest || !readStereo(reader, tap)) return

  // 처음 읽을 때는 지나간 소리를 다시 그리지 않고 지금부터 시작한다.
  const fresh = reader.receivedAt === 0 ? 0 : Math.min(((now - reader.receivedAt) / 1000) * sampleRate, METER_WINDOW)
  reader.receivedAt = now
  reader.oldest = reader.nextLeft[0]
  ;[reader.left, reader.nextLeft] = [reader.nextLeft, reader.left]
  ;[reader.right, reader.nextRight] = [reader.nextRight, reader.right]
  reader.cursor = METER_WINDOW - fresh
  reader.previous = reader.cursor
}

/** 지금 들리는 시점에서 끝나는 구간. */
export function getMeterWindow(samples: Float32Array, { cursor }: MeterReader, size: number) {
  const end = Math.max(Math.floor(cursor), size)
  return samples.subarray(end - size, end)
}

/** 지난 프레임 뒤로 지나간 샘플의 최고값. 창이 아니라 지나간 구간을 봐서 놓치는 피크가 없다. */
export function getMeterPeak(samples: Float32Array, { previous, cursor }: MeterReader) {
  let peak = 0
  for (let index = Math.floor(previous); index < Math.floor(cursor); index += 1) {
    const size = Math.abs(samples[index])
    if (size > peak) peak = size
  }
  return peak
}
