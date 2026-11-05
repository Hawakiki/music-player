import { Folder, LoaderCircle, Plus, Search, Settings2, type LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { formatCount, isDisconnected } from '@/lib/folders/status'
import type { MusicFolder } from '@/lib/folders/types'
import { LIBRARY_NAV } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { addFolder, reconnectFolder, reselectFolder, useLibrary } from '@/stores/library-store'

const ROW = 'flex h-9 items-center gap-2.5 rounded-lg px-2.5 [&_svg]:size-4.5 [&_svg]:shrink-0'
const LINK = 'text-muted-foreground transition-colors hover:bg-raised/60 hover:text-foreground'
const ACTIVE_LINK = 'bg-raised font-medium text-foreground hover:bg-raised'

interface SidebarLinkProps {
  to: string
  label: string
  icon: LucideIcon
  className?: string
}

function SidebarLink({ to, label, icon: Icon, className }: SidebarLinkProps) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) => cn(ROW, LINK, isActive && ACTIVE_LINK, className)}
    >
      <Icon />
      {label}
    </NavLink>
  )
}

interface FolderRowProps {
  folder: MusicFolder
}

function FolderRow({ folder }: FolderRowProps) {
  const { id, name, status, trackCount } = folder
  const disconnected = isDisconnected(folder)

  return (
    <div className="relative">
      <NavLink
        to={`/folders/${id}`}
        className={({ isActive }) =>
          cn(ROW, LINK, isActive && ACTIVE_LINK, disconnected && 'pr-20 text-faint')
        }
      >
        <Folder />
        <span className="truncate">{name}</span>
        {status === 'scanning' && (
          <LoaderCircle aria-label="곡 찾는 중" className="ml-auto animate-spin text-faint" />
        )}
        {!disconnected && status !== 'scanning' && (
          <span className="ml-auto text-xs font-normal whitespace-nowrap text-faint">
            {formatCount(trackCount)}곡
          </span>
        )}
      </NavLink>
      {disconnected && (
        <button
          type="button"
          onClick={() => void (status === 'missing' ? reselectFolder(id) : reconnectFolder(id))}
          className="absolute top-1/2 right-2.5 -translate-y-1/2 text-xs font-medium text-point"
        >
          {status === 'missing' ? '다시 선택' : '다시 연결'}
        </button>
      )}
    </div>
  )
}

export function Sidebar() {
  const folders = useLibrary((state) => state.folders)

  return (
    <aside className="hidden w-58 shrink-0 flex-col overflow-y-auto border-r bg-panel px-3 py-4 md:flex">
      <label className="mb-2 flex h-9 items-center gap-2 rounded-lg bg-raised px-2.5 text-muted-foreground">
        <Search className="size-4 shrink-0" />
        <input
          type="search"
          placeholder="검색"
          aria-label="검색"
          disabled
          className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground"
        />
      </label>

      <nav aria-label="라이브러리">
        <h2 className="px-2.5 pt-4 pb-1.5 text-xs text-faint">라이브러리</h2>
        {LIBRARY_NAV.map((item) => (
          <SidebarLink key={item.path} to={item.path} label={item.label} icon={item.icon} />
        ))}
      </nav>

      <section aria-label="폴더">
        <h2 className="px-2.5 pt-4 pb-1.5 text-xs text-faint">폴더</h2>
        {folders.map((folder) => (
          <FolderRow key={folder.id} folder={folder} />
        ))}
        <button type="button" onClick={() => void addFolder()} className={cn(ROW, LINK, 'w-full')}>
          <Plus />
          폴더 추가
        </button>
      </section>

      <SidebarLink to="/settings" label="설정" icon={Settings2} className="mt-auto" />
    </aside>
  )
}
