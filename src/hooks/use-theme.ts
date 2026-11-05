import { useState } from 'react'
import { readTheme, saveTheme, type Theme } from '@/lib/theme'

export function useTheme() {
  const [theme, setThemeState] = useState(readTheme)

  function setTheme(next: Theme) {
    saveTheme(next)
    setThemeState(next)
  }

  return { theme, setTheme }
}
