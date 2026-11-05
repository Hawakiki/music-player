import { Plus, Search, Settings2, type LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { LIBRARY_NAV } from '@/lib/navigation'
import { cn } from '@/lib/utils'

const ROW = 'flex h-9 items-center gap-2.5 rounded-lg px-2.5 [&_svg]:size-4.5 [&_svg]:shrink-0'

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
      className={({ isActive }) =>
        cn(
          ROW,
          'text-muted-foreground transition-colors hover:bg-raised/60 hover:text-foreground',
          isActive && 'bg-raised font-medium text-foreground hover:bg-raised',
          className,
        )
      }
    >
      <Icon />
      {label}
    </NavLink>
  )
}

export function Sidebar() {
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
        <button type="button" disabled className={cn(ROW, 'w-full text-faint')}>
          <Plus />
          폴더 추가
        </button>
      </section>

      <SidebarLink to="/settings" label="설정" icon={Settings2} className="mt-auto" />
    </aside>
  )
}
