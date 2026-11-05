import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigationType } from 'react-router-dom'
import { DropOverlay } from '@/components/folders/DropOverlay'
import { MainScrollContext } from '@/components/layout/main-scroll'
import { MobileNav } from '@/components/layout/MobileNav'
import { NoticeToast } from '@/components/layout/NoticeToast'
import { PlayerBar } from '@/components/layout/PlayerBar'
import { QueuePanel } from '@/components/layout/QueuePanel'
import { Sidebar } from '@/components/layout/Sidebar'
import { usePlayerShortcuts } from '@/hooks/use-player-shortcuts'

const MAX_RESTORE_FRAMES = 30

const scrollPositions = new Map<string, number>()

export function AppShell() {
  usePlayerShortcuts()

  // 가상 목록이 스크롤 요소를 받을 수 있도록 상태로도 들고 있는다.
  const mainRef = useRef<HTMLElement | null>(null)
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null)
  const attachMain = useCallback((element: HTMLElement | null) => {
    mainRef.current = element
    setScrollElement(element)
  }, [])

  const { pathname } = useLocation()
  const navigationType = useNavigationType()
  const currentPath = useRef(pathname)

  useLayoutEffect(() => {
    currentPath.current = pathname

    // 뒤로 가기는 보던 자리로, 새 화면은 맨 위로 간다.
    // 가상 목록은 폭을 잰 뒤에야 높이가 잡혀서 처음에는 끝까지 스크롤되지 않는다.
    const target = navigationType === 'POP' ? (scrollPositions.get(pathname) ?? 0) : 0
    let frame = 0
    let attempts = 0

    const restore = () => {
      const main = mainRef.current
      if (!main) return

      main.scrollTop = target
      attempts += 1
      if (main.scrollTop < target - 1 && attempts < MAX_RESTORE_FRAMES) {
        frame = requestAnimationFrame(restore)
      }
    }
    restore()
    return () => cancelAnimationFrame(frame)
  }, [pathname, navigationType])

  return (
    <div className="flex h-dvh flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main
          ref={attachMain}
          onScroll={(event) => scrollPositions.set(currentPath.current, event.currentTarget.scrollTop)}
          className="min-w-0 flex-1 overflow-y-auto px-4 py-6 md:px-8"
        >
          <div>
            <MainScrollContext value={scrollElement}>
              <Outlet />
            </MainScrollContext>
          </div>
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
