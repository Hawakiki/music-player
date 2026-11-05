import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { LIBRARY_NAV } from '@/lib/navigation'
import { FolderPage } from '@/pages/FolderPage'
import { FoldersPage } from '@/pages/FoldersPage'
import { LibraryPage } from '@/pages/LibraryPage'
import { SettingsPage } from '@/pages/SettingsPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/folders" element={<FoldersPage />} />
          <Route path="/folders/:id" element={<FolderPage />} />
          {LIBRARY_NAV.filter((item) => item.path !== '/folders').map((item) => (
            <Route key={item.path} path={item.path} element={<LibraryPage item={item} />} />
          ))}
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/albums" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App
