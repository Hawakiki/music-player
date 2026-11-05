import { ChevronLeft, Play, Shuffle } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { FolderActions } from '@/components/folders/FolderActions'
import { TrackList } from '@/components/player/TrackList'
import { Button } from '@/components/ui/button'
import { describeFolder } from '@/lib/folders/status'
import { useLibrary } from '@/stores/library-store'
import { playList, shufflePlay } from '@/stores/player-store'

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
          <div className="mt-4 flex gap-2">
            <Button size="lg" className="px-4" onClick={() => playList(tracks)}>
              <Play fill="currentColor" />
              재생
            </Button>
            <Button variant="secondary" size="lg" className="px-4" onClick={() => shufflePlay(tracks)}>
              <Shuffle />
              셔플
            </Button>
          </div>
          <TrackList tracks={tracks} />
        </>
      )}
    </div>
  )
}
