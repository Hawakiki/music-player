import { useMemo } from 'react'
import { isPlayable } from '@/lib/metadata/format'
import { useLibrary } from '@/stores/library-store'
import { useMetadata } from '@/stores/metadata-store'

/**
 * 폴더에서 찾은 곡 중 재생할 수 있는 곡과, 태그를 읽어 보니 재생할 수 없던 곡 수.
 * 확장자는 받는 것이라도 안에 든 코덱은 태그를 읽어야 안다. 읽기 전인 곡은 일단 넣는다.
 */
export function useFolderTracks(folderId: string | undefined) {
  const tracks = useLibrary((state) => (folderId ? state.tracks[folderId] : undefined))
  const items = useMetadata((state) => state.items)

  return useMemo(() => {
    if (!tracks) return { tracks: undefined, unplayable: 0 }

    const playable = tracks.filter((track) => {
      const meta = items[track.id]
      return !meta || isPlayable(meta)
    })
    return {
      tracks: playable.length === tracks.length ? tracks : playable,
      unplayable: tracks.length - playable.length,
    }
  }, [tracks, items])
}
