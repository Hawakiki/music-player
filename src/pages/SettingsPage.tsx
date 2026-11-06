import type { ReactNode } from 'react'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { useTheme } from '@/hooks/use-theme'
import type { Theme } from '@/lib/theme'
import { setSound, useSound, type LoudnessMode } from '@/stores/sound-store'

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'auto', label: '자동' },
  { value: 'black', label: '블랙' },
  { value: 'white', label: '화이트' },
]

const LOUDNESS_OPTIONS: { value: LoudnessMode; label: string }[] = [
  { value: 'off', label: '끔' },
  { value: 'track', label: '곡 기준' },
  { value: 'album', label: '앨범 기준' },
]

interface SettingRowProps {
  title: string
  description: string
  children: ReactNode
}

function SettingRow({ title, description, children }: SettingRowProps) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-caption text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  )
}

export function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const loudness = useSound((state) => state.loudness)
  const limiter = useSound((state) => state.limiter)

  return (
    <div className="max-w-2xl">
      <h1 className="text-title font-semibold">설정</h1>

      <section className="mt-6">
        <h2 className="border-b pb-2 text-base font-semibold">화면</h2>
        <SettingRow title="테마" description="자동은 기기나 브라우저의 다크 모드 설정을 따릅니다.">
          <SegmentedControl name="theme" options={THEME_OPTIONS} value={theme} onChange={setTheme} />
        </SettingRow>
      </section>

      <section className="mt-6">
        <h2 className="border-b pb-2 text-base font-semibold">소리</h2>
        <SettingRow
          title="음량 평준화"
          description="곡마다 다른 음량을 ReplayGain 태그로 맞춥니다. 태그가 없는 곡은 그대로 재생됩니다."
        >
          <SegmentedControl
            name="loudness"
            options={LOUDNESS_OPTIONS}
            value={loudness}
            onChange={(next) => setSound({ loudness: next })}
          />
        </SettingRow>
        <SettingRow title="리미터" description="효과로 소리가 커졌을 때 깨지지 않게 막습니다.">
          <Switch
            aria-label="리미터"
            checked={limiter}
            onCheckedChange={(next) => setSound({ limiter: next })}
            className="data-checked:bg-point"
          />
        </SettingRow>
      </section>
    </div>
  )
}
