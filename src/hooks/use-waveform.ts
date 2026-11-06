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
    let timer = 0

    // 곡 전체를 푸는 일이라 무겁다. 화면이 꺼진 동안 하면 재생과 CPU를 다툰다.
    const start = () => {
      if (document.hidden) return

      document.removeEventListener('visibilitychange', start)
      timer = window.setTimeout(() => {
        void readPeaks(track).then((peaks) => {
          if (current) setLoaded({ id: track.id, peaks })
        })
      }, START_DELAY_MS)
    }

    document.addEventListener('visibilitychange', start)
    start()

    return () => {
      current = false
      document.removeEventListener('visibilitychange', start)
      clearTimeout(timer)
    }
  }, [track])

  return loaded && loaded.id === track?.id ? loaded.peaks : null
}
