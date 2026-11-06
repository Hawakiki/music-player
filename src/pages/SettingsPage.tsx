import type { ReactNode } from 'react'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { useTheme } from '@/hooks/use-theme'
import type { Theme } from '@/lib/theme'
import {
  setSound,
  useSound,
  type CoverView,
  type LoudnessMode,
  type LpSpeed,
  type VuReference,
} from '@/stores/sound-store'

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'auto', label: '자동' },
  { value: 'black', label: '블랙' },
  { value: 'white', label: '화이트' },
]

const COVER_VIEW_OPTIONS: { value: CoverView; label: string }[] = [
  { value: 'art', label: '앨범 표지' },
  { value: 'lp', label: 'LP' },
  { value: 'vu', label: 'VU 미터' },
]

const LP_SPEED_OPTIONS: { value: LpSpeed; label: string }[] = [
  { value: '33', label: '33⅓' },
  { value: '45', label: '45' },
]

const VU_REFERENCE_OPTIONS: { value: VuReference; label: string }[] = [
  { value: '-18', label: '-18' },
  { value: '-14', label: '-14' },
  { value: '-10', label: '-10' },
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
        <p className="text-caption break-keep text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  )
}

export function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const loudness = useSound((state) => state.loudness)
  const limiter = useSound((state) => state.limiter)
  const coverView = useSound((state) => state.coverView)
  const vuReference = useSound((state) => state.vuReference)
  const lpSpeed = useSound((state) => state.lpSpeed)

  return (
    <div className="max-w-2xl">
      <h1 className="text-title font-semibold">설정</h1>

      <section className="mt-6">
        <h2 className="border-b pb-2 text-base font-semibold">화면</h2>
        <SettingRow title="테마" description="자동은 기기나 브라우저의 다크 모드 설정을 따릅니다.">
          <SegmentedControl name="theme" options={THEME_OPTIONS} value={theme} onChange={setTheme} />
        </SettingRow>
        <SettingRow title="표지 자리" description="재생 화면의 앨범 표지 자리에 보여 줄 내용입니다.">
          <SegmentedControl
            name="cover-view"
            options={COVER_VIEW_OPTIONS}
            value={coverView}
            onChange={(next) => setSound({ coverView: next })}
          />
        </SettingRow>
        <SettingRow
          title="LP 회전 속도 (rpm)"
          description="판이 도는 속도입니다. 바이닐 효과의 음높이 흔들림도 같은 주기로 맞춥니다."
        >
          <SegmentedControl
            name="lp-speed"
            options={LP_SPEED_OPTIONS}
            value={lpSpeed}
            disabled={coverView !== 'lp'}
            onChange={(next) => setSound({ lpSpeed: next })}
          />
        </SettingRow>
        <SettingRow
          title="0 VU 기준 (dBFS)"
          description="바늘이 0을 가리키는 음량입니다. 요즘 곡은 -10, 조용한 녹음은 -18이 잘 맞습니다."
        >
          <SegmentedControl
            name="vu-reference"
            options={VU_REFERENCE_OPTIONS}
            value={vuReference}
            disabled={coverView !== 'vu'}
            onChange={(next) => setSound({ vuReference: next })}
          />
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
