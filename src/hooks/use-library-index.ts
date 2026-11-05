import { getLibraryIndex } from '@/lib/library/build'
import { useLibrary } from '@/stores/library-store'
import { useMetadata } from '@/stores/metadata-store'

export function useLibraryIndex() {
  const tracks = useLibrary((state) => state.tracks)
  const items = useMetadata((state) => state.items)

  return getLibraryIndex(tracks, useLibrary.getState().folders, items)
}
