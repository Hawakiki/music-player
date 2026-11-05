import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { watchSystemTheme } from '@/lib/theme'
import { restoreFolders } from '@/stores/library-store'

watchSystemTheme()
void restoreFolders()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
