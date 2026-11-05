import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { AlbumPage } from '@/pages/AlbumPage'
import { AlbumsPage } from '@/pages/AlbumsPage'
import { ArtistPage } from '@/pages/ArtistPage'
import { ArtistsPage } from '@/pages/ArtistsPage'
import { FavoritesPage } from '@/pages/FavoritesPage'
import { FolderPage } from '@/pages/FolderPage'
import { FoldersPage } from '@/pages/FoldersPage'
import { GenrePage } from '@/pages/GenrePage'
import { GenresPage } from '@/pages/GenresPage'
import { PlaylistsPage } from '@/pages/PlaylistsPage'
import { QueuePage } from '@/pages/QueuePage'
import { RecentPage } from '@/pages/RecentPage'
import { SearchPage } from '@/pages/SearchPage'
import { SettingsPage } from '@/pages/SettingsPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/folders" element={<FoldersPage />} />
          <Route path="/folders/:id" element={<FolderPage />} />
          <Route path="/albums" element={<AlbumsPage />} />
          <Route path="/albums/:id" element={<AlbumPage />} />
          <Route path="/artists" element={<ArtistsPage />} />
          <Route path="/artists/:id" element={<ArtistPage />} />
          <Route path="/genres" element={<GenresPage />} />
          <Route path="/genres/:id" element={<GenrePage />} />
          <Route path="/playlists" element={<PlaylistsPage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/recent" element={<RecentPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/queue" element={<QueuePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/albums" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App
