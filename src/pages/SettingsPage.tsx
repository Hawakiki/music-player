import { useTheme } from '@/hooks/use-theme'
import type { Theme } from '@/lib/theme'

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'auto', label: '자동' },
  { value: 'black', label: '블랙' },
  { value: 'white', label: '화이트' },
]

export function SettingsPage() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="max-w-2xl">
      <h1 className="text-title font-semibold">설정</h1>

      <section className="mt-6">
        <h2 className="border-b pb-2 text-base font-semibold">화면</h2>
        <fieldset className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <legend className="font-medium">테마</legend>
            <p className="text-caption text-muted-foreground">
              자동은 기기나 브라우저의 다크 모드 설정을 따릅니다.
            </p>
          </div>
          <div className="inline-flex shrink-0 self-start rounded-lg bg-raised p-1 sm:self-auto">
            {THEME_OPTIONS.map(({ value, label }) => (
              <label
                key={value}
                className="rounded-md px-4 py-1.5 text-muted-foreground transition-colors has-checked:bg-panel has-checked:font-medium has-checked:text-foreground has-focus-visible:outline-2 has-focus-visible:outline-ring"
              >
                <input
                  type="radio"
                  name="theme"
                  value={value}
                  checked={theme === value}
                  onChange={() => setTheme(value)}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </section>
    </div>
  )
}
