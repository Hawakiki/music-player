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
