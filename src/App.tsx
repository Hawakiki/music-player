import { HashRouter, Route, Routes } from 'react-router-dom'
import { PlayerPage } from '@/pages/PlayerPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<PlayerPage />} />
      </Routes>
    </HashRouter>
  )
}

export default App
