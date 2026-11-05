import { ChevronLeft } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { FolderActions } from '@/components/folders/FolderActions'
import { describeFolder } from '@/lib/folders/status'
import { useLibrary } from '@/stores/library-store'

export function FolderPage() {
  const { id } = useParams()
  const ready = useLibrary((state) => state.ready)
  const folder = useLibrary((state) => state.folders.find((item) => item.id === id))
  const tracks = useLibrary((state) => (id ? state.tracks[id] : undefined))

  if (!ready) return null
  if (!folder) return <Navigate to="/folders" replace />

  return (
    <div className="max-w-3xl">
      <Link to="/folders" className="inline-flex items-center gap-1 text-caption text-muted-foreground">
        <ChevronLeft className="size-4" />
        폴더
      </Link>

      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-title font-semibold">{folder.name}</h1>
          <p className="text-muted-foreground">{describeFolder(folder)}</p>
        </div>
        <FolderActions folder={folder} />
      </div>

      {tracks && tracks.length > 0 && (
        <ul className="mt-6 border-t">
          {tracks.map(({ id: trackId, path, name }) => {
            const directory = path.slice(0, path.length - name.length - 1)
            return (
              <li
                key={trackId}
                className="flex h-11 flex-col justify-center border-b [contain-intrinsic-size:auto_44px] [content-visibility:auto]"
              >
                <span className="truncate">{name}</span>
                {directory && <span className="truncate text-xs text-faint">{directory}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
