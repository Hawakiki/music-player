import { Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, buttonVariants } from '@/components/ui/button'
import { formatCount, isDisconnected } from '@/lib/folders/status'
import type { NavItem } from '@/lib/navigation'
import { addFolder, useLibrary } from '@/stores/library-store'

interface LibraryPageProps {
  item: NavItem
}

export function LibraryPage({ item }: LibraryPageProps) {
  const { label, empty, icon: Icon } = item
  const folders = useLibrary((state) => state.folders)
  const trackCount = folders.reduce((total, folder) => total + folder.trackCount, 0)
  const scanning = folders.some((folder) => folder.status === 'scanning')
  const disconnected = folders.filter(isDisconnected).length

  return (
    <div className="flex h-full flex-col">
      <h1 className="text-title font-semibold">{label}</h1>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-16 text-center">
        <Icon className="size-8 text-faint" />
        {folders.length === 0 && (
          <>
            <p className="text-muted-foreground">{empty}</p>
            <Button variant="secondary" size="lg" className="mt-1 px-4" onClick={() => void addFolder()}>
              <Plus />
              폴더 추가
            </Button>
          </>
        )}
        {folders.length > 0 && trackCount === 0 && disconnected > 0 && (
          <>
            <p className="text-muted-foreground">폴더 {disconnected}개를 다시 연결하면 곡이 표시됩니다.</p>
            <Link to="/folders" className={buttonVariants({ size: 'lg', className: 'mt-1 px-4' })}>
              폴더 보기
            </Link>
          </>
        )}
        {folders.length > 0 && (trackCount > 0 || disconnected === 0) && (
          <p className="text-muted-foreground">
            {scanning
              ? `곡을 찾고 있습니다. 지금까지 ${formatCount(trackCount)}곡`
              : `곡 ${formatCount(trackCount)}개를 찾았습니다. 곡 정보를 읽는 기능은 준비 중입니다.`}
          </p>
        )}
      </div>
    </div>
  )
}
