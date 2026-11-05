export type Theme = 'auto' | 'black' | 'white'

// index.html의 인라인 스크립트도 같은 키와 규칙을 쓴다.
const STORAGE_KEY = 'music-player:theme'
const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

function isTheme(value: string | null): value is Theme {
  return value === 'auto' || value === 'black' || value === 'white'
}

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isTheme(stored) ? stored : 'auto'
  } catch {
    return 'auto'
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  const dark = theme === 'black' || (theme === 'auto' && systemDark.matches)

  // 전환 효과가 걸린 요소만 늦게 바뀌어 화면이 얼룩지지 않도록 이 순간에는 끈다.
  root.classList.add('theme-switching')
  root.classList.toggle('dark', dark)
  void root.offsetHeight
  root.classList.remove('theme-switching')
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // 저장소를 쓸 수 없어도 지금 화면에는 적용한다.
  }
  applyTheme(theme)
}

export function watchSystemTheme() {
  systemDark.addEventListener('change', () => applyTheme(readTheme()))
}
