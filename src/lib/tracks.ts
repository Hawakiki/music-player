import type { TrackFile } from '@/lib/folders/types'
import type { TrackMeta } from '@/lib/metadata/types'

/** 태그가 없으면 파일 이름을 제목으로 쓴다. */
export function trackTitle(track: TrackFile, meta?: TrackMeta) {
  if (meta?.title) return meta.title

  const dot = track.name.lastIndexOf('.')
  return dot > 0 ? track.name.slice(0, dot) : track.name
}

export function trackDirectory({ path, name }: TrackFile) {
  return path.slice(0, Math.max(0, path.length - name.length - 1))
}

/** 태그가 없으면 곡이 있는 폴더 경로를 보여 준다. */
export function trackSubtitle(track: TrackFile, meta?: TrackMeta) {
  return meta?.artist ?? trackDirectory(track)
}
