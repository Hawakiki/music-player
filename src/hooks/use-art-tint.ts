import { useEffect, useState } from 'react'
import { type ArtTint, measureTint } from '@/lib/art-tint'
import { loadArt } from '@/lib/db'

const tints = new Map<string, ArtTint | null>()
const loading = new Map<string, Promise<ArtTint | null>>()

async function fetchTint(id: string) {
  const image = await loadArt(id).catch(() => undefined)
  const tint = image ? await measureTint(image).catch(() => null) : null
  tints.set(id, tint)
  return tint
}

function loadTint(id: string) {
  const pending = loading.get(id) ?? fetchTint(id)
  loading.set(id, pending)
  return pending
}

/** 표지 썸네일에서 배경에 깔 색을 뽑는다. 표지가 없으면 null이다. */
export function useArtTint(artId: string | undefined) {
  const [shown, setShown] = useState<{ id: string | undefined; tint: ArtTint | null }>({ id: undefined, tint: null })
  const known = !artId || tints.has(artId)
  const tint = artId ? (tints.get(artId) ?? null) : null
  if (known && shown.id !== artId) setShown({ id: artId, tint })

  useEffect(() => {
    if (!artId || tints.has(artId)) return

    let current = true
    void loadTint(artId).then((value) => {
      if (current) setShown({ id: artId, tint: value })
    })
    return () => {
      current = false
    }
  }, [artId])

  // 불러오는 동안은 앞 곡의 색을 유지한다. 비웠다가 다시 칠하면 깜빡인다.
  return known ? tint : shown.tint
}
