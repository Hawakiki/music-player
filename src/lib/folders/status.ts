import type { MusicFolder } from './types'

export function formatCount(count: number) {
  return count.toLocaleString('ko-KR')
}

export function isDisconnected({ status }: MusicFolder) {
  return status === 'needs-permission' || status === 'missing'
}

export function describeFolder({ status, trackCount, unsupportedCount }: MusicFolder) {
  const skipped = unsupportedCount > 0 ? `, 재생할 수 없는 형식 ${formatCount(unsupportedCount)}개 제외` : ''

  switch (status) {
    case 'scanning':
      return `곡 찾는 중 ${formatCount(trackCount)}곡`
    case 'connected':
      return `${formatCount(trackCount)}곡${skipped}`
    case 'session':
      return `${formatCount(trackCount)}곡${skipped}, 페이지를 닫으면 목록에서 사라집니다`
    case 'needs-permission':
      return '다시 연결하면 곡이 표시됩니다'
    case 'missing':
      return '폴더를 찾을 수 없습니다. 이동했거나 삭제됐을 수 있습니다'
  }
}
