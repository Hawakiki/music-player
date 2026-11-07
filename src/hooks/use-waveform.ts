import { useEffect, useState } from 'react'
import type { TrackFile } from '@/lib/folders/types'
import { readPeaks } from '@/lib/player/waveform'
import { usePlayer } from '@/stores/player-store'

/** 곡을 빠르게 넘길 때 전부 풀지 않도록 잠시 기다렸다가 시작한다. */
const START_DELAY_MS = 250
/**
 * 파형을 만들려면 곡 전체를 메모리에 푼다. 압축률이 높은 곡은 파일이 작아도 크게 풀려서,
 * 6시간 반짜리 MP3 하나로 10GB를 넘었다. 이보다 긴 곡은 일반 탐색바를 쓴다.
 */
const MAX_DURATION_SECONDS = 30 * 60

export function useWaveform(track: TrackFile | undefined) {
  const [loaded, setLoaded] = useState<{ id: string; peaks: Uint8Array | null } | null>(null)
  // 길이를 알기 전에는 풀지 않는다.
  const tooLong = usePlayer((player) =>
    player.duration > 0 ? player.duration > MAX_DURATION_SECONDS : null,
  )

  useEffect(() => {
    if (!track || tooLong !== false) return

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
  }, [track, tooLong])

  return loaded && loaded.id === track?.id ? loaded.peaks : null
}
