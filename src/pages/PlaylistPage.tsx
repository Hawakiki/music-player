import { ChevronLeft, Download, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { PlayButtons } from '@/components/library/PlayButtons'
import { TrackArt } from '@/components/player/TrackArt'
import { TrackList, type TrackListEditing } from '@/components/player/TrackList'
import { NameDialog } from '@/components/playlists/NameDialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useLibraryIndex } from '@/hooks/use-library-index'
import { formatCount } from '@/lib/folders/status'
import { resolvePlaylist } from '@/lib/playlists/resolve'
import { useMetadata } from '@/stores/metadata-store'
import {
  exportPlaylists,
  moveEntry,
  removeEntry,
  removePlaylist,
  renamePlaylist,
  usePlaylists,
} from '@/stores/playlists-store'

export function PlaylistPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const ready = usePlaylists((state) => state.ready)
  const playlist = usePlaylists((state) => state.playlists.find((item) => item.id === id))
  const library = useLibraryIndex()
  const metas = useMetadata((state) => state.items)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const resolved = useMemo(() => playlist && resolvePlaylist(playlist, library), [playlist, library])
  const tracks = useMemo(() => resolved?.rows.map((row) => row.track) ?? [], [resolved])

  const editing = useMemo<TrackListEditing | undefined>(() => {
    if (!resolved) return undefined
    const { rows } = resolved

    return {
      onRemove: (index) => removeEntry(id, rows[index].entryIndex),
      // 찾지 못한 곡이 사이에 있어도 화면 순서대로 옮겨지도록 실제 위치로 바꾼다.
      onMove: (from, before) => {
        const target = rows[before]?.entryIndex ?? rows[rows.length - 1].entryIndex + 1
        moveEntry(id, rows[from].entryIndex, target)
      },
    }
  }, [id, resolved])

  if (!ready) return null
  if (!playlist || !resolved) return <Navigate to="/playlists" replace />

  const artId = tracks[0] && metas[tracks[0].id]?.artId

  return (
    <>
      <Link to="/playlists" className="inline-flex items-center gap-1 text-caption text-muted-foreground">
        <ChevronLeft className="size-4" />
        재생목록
      </Link>

      <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
        <TrackArt artId={artId} className="size-36" />
        <div className="min-w-0">
          <h1 className="text-title leading-tight font-semibold">{playlist.name}</h1>
          <p className="text-muted-foreground">
            {formatCount(playlist.entries.length)}곡
            {resolved.missing > 0 && `, 찾지 못한 곡 ${formatCount(resolved.missing)}개`}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {tracks.length > 0 && <PlayButtons tracks={tracks} label={playlist.name} />}
            <Button variant="ghost" size="lg" className="px-3" onClick={() => setRenaming(true)}>
              <Pencil />
              이름 변경
            </Button>
            <Button variant="ghost" size="lg" className="px-3" onClick={() => exportPlaylists([playlist])}>
              <Download />
              내보내기
            </Button>
            <Button variant="ghost" size="lg" className="px-3" onClick={() => setDeleting(true)}>
              <Trash2 />
              삭제
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-6">
        {tracks.length > 0 ? (
          <TrackList tracks={tracks} editing={editing} />
        ) : (
          <p className="text-muted-foreground">
            {playlist.entries.length > 0
              ? '곡을 찾지 못했습니다. 곡이 있는 폴더를 연결하면 다시 표시됩니다.'
              : '곡의 더 보기 메뉴에서 이 재생목록에 넣을 수 있습니다.'}
          </p>
        )}
      </div>

      <NameDialog
        open={renaming}
        title="재생목록 이름 변경"
        initialName={playlist.name}
        confirmLabel="변경"
        onClose={() => setRenaming(false)}
        onSubmit={(name) => {
          renamePlaylist(id, name)
          setRenaming(false)
        }}
      />

      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>재생목록 삭제</DialogTitle>
            <DialogDescription>{playlist.name}을(를) 삭제합니다. 음악 파일은 그대로 남습니다.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="lg" className="px-3" onClick={() => setDeleting(false)}>
              취소
            </Button>
            <Button
              variant="destructive"
              size="lg"
              className="px-3"
              onClick={() => {
                removePlaylist(id)
                navigate('/playlists', { replace: true })
              }}
            >
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
