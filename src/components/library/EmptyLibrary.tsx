import { Plus, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, buttonVariants } from '@/components/ui/button'
import { isDisconnected } from '@/lib/folders/status'
import { addFolder, useLibrary } from '@/stores/library-store'
import { useMetadata } from '@/stores/metadata-store'

interface EmptyLibraryProps {
  icon: LucideIcon
  /** 폴더가 없을 때 보여 줄 안내. */
  message: string
  /** 폴더는 있는데 이 화면에 보여 줄 것이 없을 때의 안내. */
  emptyMessage: string
}

export function EmptyLibrary({ icon: Icon, message, emptyMessage }: EmptyLibraryProps) {
  const folders = useLibrary((state) => state.folders)
  const reading = useMetadata((state) => state.total > 0)
  const scanning = folders.some((folder) => folder.status === 'scanning')
  const disconnected = folders.filter(isDisconnected).length

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <Icon className="size-8 text-faint" />
      {folders.length === 0 ? (
        <>
          <p className="text-muted-foreground">{message}</p>
          <Button variant="secondary" size="lg" className="mt-1 px-4" onClick={() => void addFolder()}>
            <Plus />
            폴더 추가
          </Button>
        </>
      ) : scanning || reading ? (
        <p className="text-muted-foreground">곡 정보를 읽고 있습니다.</p>
      ) : disconnected > 0 ? (
        <>
          <p className="text-muted-foreground">폴더 {disconnected}개를 다시 연결하면 곡이 표시됩니다.</p>
          <Link to="/folders" className={buttonVariants({ size: 'lg', className: 'mt-1 px-4' })}>
            폴더 보기
          </Link>
        </>
      ) : (
        <p className="text-muted-foreground">{emptyMessage}</p>
      )}
    </div>
  )
}
