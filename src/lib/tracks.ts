import type { TrackFile } from '@/lib/folders/types'

/** 태그를 읽기 전까지는 파일 이름을 제목으로 쓴다. */
export function trackTitle({ name }: TrackFile) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export function trackDirectory({ path, name }: TrackFile) {
  return path.slice(0, Math.max(0, path.length - name.length - 1))
}
