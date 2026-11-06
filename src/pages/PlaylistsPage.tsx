import { Download, ListMusic, Plus, Upload } from 'lucide-react'
import { useMemo } from 'react'
import { NameList } from '@/components/library/NameList'
import { PageHeader } from '@/components/library/PageHeader'
import { Button } from '@/components/ui/button'
import { useLibraryIndex } from '@/hooks/use-library-index'
import { formatCount } from '@/lib/folders/status'
import { resolvePlaylist } from '@/lib/playlists/resolve'
import { useMetadata } from '@/stores/metadata-store'
import { exportPlaylists, importPlaylists, openCreatePlaylist, usePlaylists } from '@/stores/playlists-store'

export function PlaylistsPage() {
  const playlists = usePlaylists((state) => state.playlists)
  const library = useLibraryIndex()
  const metas = useMetadata((state) => state.items)

  const items = useMemo(
    () =>
      playlists.map((playlist) => {
        const first = resolvePlaylist(playlist, library).rows[0]
        return {
          id: playlist.id,
          name: playlist.name,
          detail: `${formatCount(playlist.entries.length)}곡`,
          artId: first && metas[first.track.id]?.artId,
          to: `/playlists/${playlist.id}`,
        }
      }),
    [playlists, library, metas],
  )

  return (
    <>
      <PageHeader title="재생목록" count={playlists.length > 0 ? `${formatCount(playlists.length)}개` : undefined}>
        <Button variant="ghost" size="lg" className="px-3" onClick={() => void importPlaylists()}>
          <Upload />
          가져오기
        </Button>
        {playlists.length > 0 && (
          <Button variant="ghost" size="lg" className="px-3" onClick={() => exportPlaylists(playlists)}>
            <Download />
            내보내기
          </Button>
        )}
        <Button variant="secondary" size="lg" className="px-3" onClick={() => openCreatePlaylist()}>
          <Plus />새 재생목록
        </Button>
      </PageHeader>

      {items.length > 0 ? (
        <NameList items={items} />
      ) : (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <ListMusic className="size-8 text-faint" />
          <p className="text-muted-foreground">만든 재생목록이 여기에 표시됩니다.</p>
          <p className="text-caption text-faint">곡의 더 보기 메뉴에서 재생목록에 넣을 수 있습니다.</p>
        </div>
      )}
    </>
  )
}
