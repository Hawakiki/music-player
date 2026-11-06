/**
 * 곡 id는 폴더를 다시 추가하면 바뀐다. 재생목록은 백업에서도 곡을 찾을 수 있도록
 * 폴더 이름과 경로, 태그로 곡을 가리킨다.
 */
export interface PlaylistEntry {
  folder: string
  path: string
  title?: string
  artist?: string
  album?: string
}

export interface Playlist {
  id: string
  name: string
  entries: PlaylistEntry[]
  createdAt: number
  updatedAt: number
}
