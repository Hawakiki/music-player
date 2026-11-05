import { Clock, Disc, Folder, Heart, ListMusic, Tag, User, type LucideIcon } from 'lucide-react'

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
  empty: string
  mobile?: boolean
}

export const LIBRARY_NAV: NavItem[] = [
  { path: '/folders', label: '폴더', icon: Folder, empty: '추가한 폴더가 여기에 표시됩니다.', mobile: true },
  { path: '/albums', label: '앨범', icon: Disc, empty: '폴더를 추가하면 앨범이 여기에 표시됩니다.', mobile: true },
  { path: '/artists', label: '아티스트', icon: User, empty: '폴더를 추가하면 아티스트가 여기에 표시됩니다.', mobile: true },
  { path: '/genres', label: '장르', icon: Tag, empty: '폴더를 추가하면 장르가 여기에 표시됩니다.' },
  { path: '/playlists', label: '재생목록', icon: ListMusic, empty: '만든 재생목록이 여기에 표시됩니다.', mobile: true },
  { path: '/favorites', label: '즐겨찾기', icon: Heart, empty: '즐겨찾기한 곡이 여기에 표시됩니다.' },
  { path: '/recent', label: '최근 추가', icon: Clock, empty: '최근에 추가된 곡이 여기에 표시됩니다.' },
]
