import { Outlet } from 'react-router-dom'
import { DropOverlay } from '@/components/folders/DropOverlay'
import { MobileNav } from '@/components/layout/MobileNav'
import { NoticeToast } from '@/components/layout/NoticeToast'
import { PlayerBar } from '@/components/layout/PlayerBar'
import { QueuePanel } from '@/components/layout/QueuePanel'
import { Sidebar } from '@/components/layout/Sidebar'

export function AppShell() {
  return (
    <div className="flex h-dvh flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
          <Outlet />
        </main>
        <QueuePanel />
      </div>
      <PlayerBar />
      <MobileNav />
      <NoticeToast />
      <DropOverlay />
    </div>
  )
}
