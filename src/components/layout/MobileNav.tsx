import { Settings2 } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { LIBRARY_NAV } from '@/lib/navigation'
import { cn } from '@/lib/utils'

const ITEMS = [
  ...LIBRARY_NAV.filter((item) => item.mobile),
  { path: '/settings', label: '설정', icon: Settings2 },
]

export function MobileNav() {
  return (
    <nav
      aria-label="메뉴"
      className="grid shrink-0 grid-cols-5 border-t bg-panel pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {ITEMS.map(({ path, label, icon: Icon }) => (
        <NavLink
          key={path}
          to={path}
          className={({ isActive }) =>
            cn(
              'flex h-14 flex-col items-center justify-center gap-1 text-xs text-muted-foreground',
              isActive && 'font-medium text-point',
            )
          }
        >
          <Icon className="size-5" />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
