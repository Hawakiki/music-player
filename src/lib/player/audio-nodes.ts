/** lowpass와 highpass의 Q는 dB 단위라서 버터워스 값이 0.707이 아니라 -3.01이다. */
const BUTTERWORTH_Q_DB = -3.01
/** 시간 상수의 이만큼이 지나면 차이가 들리지 않는다. */
const SETTLE_TIME_CONSTANTS = 10

const targets = new WeakMap<AudioParam, number>()

export function dbToGain(db: number) {
  return 10 ** (db / 20)
}

/**
 * 값을 부드럽게 옮기고 예약을 끝낸다. 예약이 남은 값은 계속 변하는 것으로 다뤄져서,
 * 필터가 매 샘플 계수를 다시 계산하고 게인이 0이어도 뒤쪽 노드가 쉬지 못해서 부하가 두 배 넘게 든다.
 */
export function smoothParam(param: AudioParam, value: number, seconds: number, now: number) {
  if ((targets.get(param) ?? param.value) === value) return
  targets.set(param, value)

  param.cancelScheduledValues(now)
  param.setTargetAtTime(value, now, seconds)
  param.setValueAtTime(value, now + seconds * SETTLE_TIME_CONSTANTS)
}

/** 소리가 지나지 않는 동안에는 예약이 처리되지 않아 값이 중간에 멈춘다. 그때는 바로 넣는다. */
export function snapParam(param: AudioParam, value: number) {
  targets.set(param, value)
  param.cancelScheduledValues(0)
  param.value = value
}

export function createFilter(context: BaseAudioContext, type: BiquadFilterType, frequency: number, gain = 0) {
  const filter = context.createBiquadFilter()
  filter.type = type
  filter.frequency.value = frequency
  filter.gain.value = gain
  return filter
}

export function createButterworth(context: BaseAudioContext, type: 'lowpass' | 'highpass', frequency: number) {
  const filter = createFilter(context, type, frequency)
  filter.Q.value = BUTTERWORTH_Q_DB
  return filter
}
