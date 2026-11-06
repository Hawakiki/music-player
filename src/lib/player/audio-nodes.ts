/** lowpass와 highpass의 Q는 dB 단위라서 버터워스 값이 0.707이 아니라 -3.01이다. */
const BUTTERWORTH_Q_DB = -3.01

export function dbToGain(db: number) {
  return 10 ** (db / 20)
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
