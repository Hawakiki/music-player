import { Folder, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { FolderActions } from '@/components/folders/FolderActions'
import { Button } from '@/components/ui/button'
import { canRememberFolders } from '@/lib/folders/access'
import { describeFolder, isDisconnected } from '@/lib/folders/status'
import { cn } from '@/lib/utils'
import { addFolder, useLibrary } from '@/stores/library-store'

export function FoldersPage() {
  const folders = useLibrary((state) => state.folders)

  return (
    <div className="flex h-full max-w-3xl flex-col">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-title font-semibold">폴더</h1>
        <Button variant="secondary" size="lg" className="px-4" onClick={() => void addFolder()}>
          <Plus />
          폴더 추가
        </Button>
      </div>

      {!canRememberFolders && (
        <p className="mt-4 rounded-lg bg-raised px-4 py-3 text-muted-foreground">
          이 브라우저는 폴더를 기억하지 못해서 방문할 때마다 다시 선택해야 합니다. Chrome이나 Edge에서는
          다시 방문해도 폴더가 유지됩니다.
        </p>
      )}

      {folders.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-16 text-center">
          <Folder className="size-8 text-faint" />
          <p className="text-muted-foreground">추가한 폴더가 여기에 표시됩니다.</p>
          <p className="text-caption text-faint">폴더를 이 창으로 끌어와도 추가됩니다.</p>
        </div>
      ) : (
        <ul className="mt-6 border-t">
          {folders.map((folder) => (
            <li
              key={folder.id}
              className="flex flex-col gap-3 border-b py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <Link to={`/folders/${folder.id}`} className="flex min-w-0 items-center gap-3 rounded-md">
                <Folder className={cn('size-5 shrink-0 text-muted-foreground', isDisconnected(folder) && 'text-faint')} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{folder.name}</span>
                  <span className="block text-caption text-muted-foreground">{describeFolder(folder)}</span>
                </span>
              </Link>
              <FolderActions folder={folder} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
