import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { LIBRARY_NAV } from '@/lib/navigation'
import { LibraryPage } from '@/pages/LibraryPage'
import { SettingsPage } from '@/pages/SettingsPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          {LIBRARY_NAV.map((item) => (
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
