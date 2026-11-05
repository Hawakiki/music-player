import { useLibrary } from '@/stores/library-store'
import { useMetadata } from '@/stores/metadata-store'

/** 폴더를 불러오거나 곡 정보를 읽는 중이면 상세 화면이 아직 없는 항목을 '없음'으로 판단하지 않게 한다. */
export function useLibraryLoading() {
  const ready = useLibrary((state) => state.ready)
  const scanning = useLibrary((state) => state.folders.some((folder) => folder.status === 'scanning'))
  const reading = useMetadata((state) => state.total > 0)

  return !ready || scanning || reading
}
