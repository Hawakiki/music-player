import type { MusicFolder } from './types'

export function formatCount(count: number) {
  return count.toLocaleString('ko-KR')
}

export function isDisconnected({ status }: MusicFolder) {
  return status === 'needs-permission' || status === 'missing'
}

/** `unplayable`은 확장자로는 받았지만 태그를 읽어 보니 재생할 수 없는 코덱이던 곡 수다. */
export function describeFolder({ status, trackCount, unsupportedCount }: MusicFolder, unplayable = 0) {
  const skippedCount = unsupportedCount + unplayable
  const skipped = skippedCount > 0 ? `, 재생할 수 없는 형식 ${formatCount(skippedCount)}개 제외` : ''
  const playableCount = trackCount - unplayable

  switch (status) {
    case 'scanning':
      return `곡 찾는 중 ${formatCount(playableCount)}곡`
    case 'connected':
      return `${formatCount(playableCount)}곡${skipped}`
    case 'session':
      return `${formatCount(playableCount)}곡${skipped}, 페이지를 닫으면 목록에서 사라집니다`
    case 'needs-permission':
      return '다시 연결하면 곡이 표시됩니다'
    case 'missing':
      return '폴더를 찾을 수 없습니다. 이동했거나 삭제됐을 수 있습니다'
  }
}
