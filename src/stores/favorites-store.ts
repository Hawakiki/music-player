import { create } from 'zustand'
import { deleteFavorite, loadFavorites, saveFavorite } from '@/lib/db'
import type { TrackFile } from '@/lib/folders/types'
import { notify, useLibrary } from '@/stores/library-store'

interface FavoritesState {
  /** 곡 id와 추가한 시각. */
  items: Record<string, number>
}

export const useFavorites = create<FavoritesState>(() => ({ items: {} }))

export function toggleFavorite({ id, folderId }: TrackFile) {
  const isFavorite = useFavorites.getState().items[id] !== undefined
  const addedAt = Date.now()

  useFavorites.setState((state) => {
    const items = { ...state.items }
    if (isFavorite) delete items[id]
    else items[id] = addedAt
    return { items }
  })

  const saving = isFavorite ? deleteFavorite(id) : saveFavorite({ id, folderId, addedAt })
  saving.catch(() => notify('즐겨찾기를 저장하지 못했습니다.'))
}

export async function initFavorites() {
  try {
    const favorites = await loadFavorites()
    useFavorites.setState({
      items: Object.fromEntries(favorites.map(({ id, addedAt }) => [id, addedAt])),
    })
  } catch {
    notify('즐겨찾기를 불러오지 못했습니다.')
  }

  // 저장소의 기록은 폴더를 제거할 때 metadata-store가 곡 정보와 함께 지운다.
  useLibrary.subscribe((state, previous) => {
    if (state.folders === previous.folders) return

    const remaining = new Set(state.folders.map((folder) => folder.id))
    const removed = previous.folders.filter((folder) => !remaining.has(folder.id))
    if (removed.length === 0) return

    const prefixes = removed.map((folder) => `${folder.id}:`)
    useFavorites.setState((current) => ({
      items: Object.fromEntries(
        Object.entries(current.items).filter(([id]) => !prefixes.some((prefix) => id.startsWith(prefix))),
      ),
    }))
  })
}
