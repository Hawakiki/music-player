import { useEffect, useState } from 'react'
import type { TrackFile } from '@/lib/folders/types'
import { readPeaks } from '@/lib/player/waveform'

/** 곡을 빠르게 넘길 때 전부 풀지 않도록 잠시 기다렸다가 시작한다. */
const START_DELAY_MS = 250

export function useWaveform(track: TrackFile | undefined) {
  const [loaded, setLoaded] = useState<{ id: string; peaks: Uint8Array | null } | null>(null)

  useEffect(() => {
    if (!track) return

    let current = true
    const timer = setTimeout(() => {
      void readPeaks(track).then((peaks) => {
        if (current) setLoaded({ id: track.id, peaks })
      })
    }, START_DELAY_MS)

    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [track])

  return loaded && loaded.id === track?.id ? loaded.peaks : null
}
