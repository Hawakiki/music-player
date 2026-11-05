import { useEffect, useState } from 'react'
import { loadArt } from '@/lib/db'

const urls = new Map<string, string>()
const loading = new Map<string, Promise<string | null>>()

async function fetchArtUrl(id: string) {
  const image = await loadArt(id).catch(() => undefined)
  if (!image) return null

  const url = URL.createObjectURL(image)
  urls.set(id, url)
  return url
}

/** 썸네일은 작아서 세션 동안 URL을 유지한다. */
export function loadArtUrl(id: string) {
  const known = urls.get(id)
  if (known) return Promise.resolve(known)

  const pending = loading.get(id) ?? fetchArtUrl(id)
  loading.set(id, pending)
  return pending
}

export function useArtUrl(artId: string | undefined) {
  const [loaded, setLoaded] = useState<{ id: string; url: string | null } | null>(null)

  useEffect(() => {
    if (!artId || urls.has(artId)) return

    let current = true
    void loadArtUrl(artId).then((url) => {
      if (current) setLoaded({ id: artId, url })
    })
    return () => {
      current = false
    }
  }, [artId])

  if (!artId) return null
  return urls.get(artId) ?? (loaded?.id === artId ? loaded.url : null)
}
