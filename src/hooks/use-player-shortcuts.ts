import { useEffect } from 'react'
import { seekStep, togglePlay } from '@/stores/player-store'

const INTERACTIVE = 'input, textarea, select, button, a, [contenteditable]'

export function usePlayerShortcuts() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return

      if (event.code === 'Space') {
        event.preventDefault()
        togglePlay()
      } else if (event.code === 'ArrowLeft') {
        seekStep(-1)
      } else if (event.code === 'ArrowRight') {
        seekStep(1)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
