import { NameDialog } from '@/components/playlists/NameDialog'
import { closeCreatePlaylist, createPlaylist, usePlaylists } from '@/stores/playlists-store'

export function CreatePlaylistDialog() {
  const open = usePlaylists((state) => state.creating !== null)

  return (
    <NameDialog
      open={open}
      title="새 재생목록"
      confirmLabel="만들기"
      onSubmit={createPlaylist}
      onClose={closeCreatePlaylist}
    />
  )
}
