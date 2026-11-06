import { loadWave, saveWave } from '@/lib/db'
import type { TrackFile } from '@/lib/folders/types'

export const WAVE_BARS = 240

/** 파형 모양만 필요하므로 낮은 샘플레이트로 풀어서 메모리를 아낀다. */
const DECODE_SAMPLE_RATE = 8000
const MAX_FILE_BYTES = 500 * 1024 * 1024

async function computePeaks(file: File) {
  const context = new OfflineAudioContext(1, 1, DECODE_SAMPLE_RATE)
  const samples = (await context.decodeAudioData(await file.arrayBuffer())).getChannelData(0)
  const step = samples.length / WAVE_BARS
  const levels = new Float32Array(WAVE_BARS)

  for (let bar = 0; bar < WAVE_BARS; bar += 1) {
    const start = Math.floor(bar * step)
    const end = Math.max(start + 1, Math.floor((bar + 1) * step))
    let sum = 0
    for (let i = start; i < end; i += 1) sum += samples[i] * samples[i]
    levels[bar] = Math.sqrt(sum / (end - start))
  }

  const loudest = Math.max(...levels) || 1
  return Uint8Array.from(levels, (level) => Math.round((level / loudest) * 255))
}

/** 파일을 읽거나 풀지 못하면 null을 돌려준다. 그때는 일반 탐색바를 보여 준다. */
export async function readPeaks(track: TrackFile) {
  try {
    const file = track.source instanceof File ? track.source : await track.source.getFile()
    const { size, lastModified } = file

    const cached = await loadWave(track.id)
    if (cached?.size === size && cached.lastModified === lastModified) return cached.peaks
    if (size > MAX_FILE_BYTES) return null

    const peaks = await computePeaks(file)
    await saveWave({ id: track.id, folderId: track.folderId, size, lastModified, peaks })
    return peaks
  } catch {
    return null
  }
}
