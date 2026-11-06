import { ChevronLeft } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { FolderActions } from '@/components/folders/FolderActions'
import { PlayButtons } from '@/components/library/PlayButtons'
import { TrackList } from '@/components/player/TrackList'
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
        <>
          <div className="mt-4">
            <PlayButtons tracks={tracks} label={folder.name} />
          </div>
          <div className="mt-4">
            <TrackList tracks={tracks} />
          </div>
        </>
      )}
    </div>
  )
}
