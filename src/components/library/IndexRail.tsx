import type { IndexEntry } from '@/lib/library/initials'

interface IndexRailProps {
  entries: IndexEntry[]
  onSelect: (index: number) => void
}

export function IndexRail({ entries, onSelect }: IndexRailProps) {
  if (entries.length < 2) return null

  return (
    <nav
      aria-label="첫 글자로 이동"
      className="sticky top-0 hidden max-h-[calc(100dvh-10rem)] w-6 shrink-0 flex-col items-center self-start overflow-y-auto [scrollbar-width:none] sm:flex"
    >
      {entries.map(({ label, index }) => (
        <button
          key={label}
          type="button"
          aria-label={`${label}(으)로 이동`}
          onClick={() => onSelect(index)}
          className="w-full shrink-0 rounded-sm text-center text-xs leading-5 text-faint transition-colors hover:text-point"
        >
          {label}
        </button>
      ))}
    </nav>
  )
}
