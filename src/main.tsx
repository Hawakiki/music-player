import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { watchSystemTheme } from '@/lib/theme'
import { initEq } from '@/stores/eq-store'
import { initFavorites } from '@/stores/favorites-store'
import { restoreFolders } from '@/stores/library-store'
import { initMetadata } from '@/stores/metadata-store'
import { initPlayer } from '@/stores/player-store'
import { initPlaylists } from '@/stores/playlists-store'

watchSystemTheme()
initEq()
initPlayer()
// 캐시를 먼저 불러와야 폴더를 스캔할 때 바뀐 파일만 다시 읽는다.
void Promise.all([initMetadata(), initFavorites(), initPlaylists()]).then(restoreFolders)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
