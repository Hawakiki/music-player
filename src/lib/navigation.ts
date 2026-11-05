import { Clock, Disc, Folder, Heart, ListMusic, Tag, User, type LucideIcon } from 'lucide-react'

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
  mobile?: boolean
}

export const LIBRARY_NAV: NavItem[] = [
  { path: '/folders', label: '폴더', icon: Folder, mobile: true },
  { path: '/albums', label: '앨범', icon: Disc, mobile: true },
  { path: '/artists', label: '아티스트', icon: User, mobile: true },
  { path: '/genres', label: '장르', icon: Tag },
  { path: '/playlists', label: '재생목록', icon: ListMusic, mobile: true },
  { path: '/favorites', label: '즐겨찾기', icon: Heart },
  { path: '/recent', label: '최근 추가', icon: Clock },
]
