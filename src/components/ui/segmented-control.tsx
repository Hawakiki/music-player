import { cn } from '@/lib/utils'

interface SegmentedOption<T extends string> {
  value: T
  label: string
}

interface SegmentedControlProps<T extends string> {
  name: string
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
}

export function SegmentedControl<T extends string>({
  name,
  options,
  value,
  onChange,
  disabled = false,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={cn('inline-flex shrink-0 self-start rounded-lg bg-raised p-1 sm:self-auto', disabled && 'opacity-50')}
    >
      {options.map((option) => (
        // relative가 없으면 숨긴 라디오가 스크롤 영역 밖에 놓인다. 그러면 문서가 길어지고,
        // 휴대폰에서 탭할 때 포커스를 따라 앱 전체가 화면 밖으로 밀려난다.
        <label
          key={option.value}
          className="relative rounded-md px-3 py-1.5 text-muted-foreground transition-colors has-checked:bg-panel has-checked:font-medium has-checked:text-foreground has-focus-visible:outline-2 has-focus-visible:outline-ring"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </div>
  )
}
