import { useEffect, useState } from 'react'
import type { TrackFile } from '@/lib/folders/types'
import { requestCover } from '@/stores/metadata-store'

/** 썸네일은 큰 화면에서 흐려서 전체 화면에서는 원본을 파일에서 읽는다. */
export function useFullCover(track: TrackFile | undefined) {
  const [cover, setCover] = useState<{ id: string; url: string } | null>(null)

  useEffect(() => {
    if (!track) return

    let current = true
    let url: string | null = null

    void requestCover(track).then((image) => {
      if (!current || !image) return
      url = URL.createObjectURL(image)
      setCover({ id: track.id, url })
    })

    return () => {
      current = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [track])

  return cover && cover.id === track?.id ? cover.url : null
}
