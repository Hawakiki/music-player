import { Button } from '@/components/ui/button'
import type { MusicFolder } from '@/lib/folders/types'
import { reconnectFolder, removeFolder, rescanFolder, reselectFolder } from '@/stores/library-store'

interface FolderActionsProps {
  folder: MusicFolder
}

export function FolderActions({ folder }: FolderActionsProps) {
  const { id, status } = folder

  return (
    <div className="flex shrink-0 items-center gap-2">
      {status === 'needs-permission' && (
        <Button size="lg" className="px-3" onClick={() => void reconnectFolder(id)}>
          다시 연결
        </Button>
      )}
      {status === 'missing' && (
        <Button size="lg" className="px-3" onClick={() => void reselectFolder(id)}>
          다시 선택
        </Button>
      )}
      {status === 'connected' && (
        <Button variant="secondary" size="lg" className="px-3" onClick={() => void rescanFolder(id)}>
          다시 검색
        </Button>
      )}
      <Button variant="ghost" size="lg" className="px-3" onClick={() => void removeFolder(id)}>
        제거
      </Button>
    </div>
  )
}
