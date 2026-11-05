import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { IndexRail } from '@/components/library/IndexRail'
import { useMainScroll, useScrollMargin } from '@/components/layout/main-scroll'
import { TrackArt } from '@/components/player/TrackArt'
import { buildIndex } from '@/lib/library/initials'

const ROW_HEIGHT = 60

export interface NameListItem {
  id: string
  name: string
  detail: string
  artId?: string
  to: string
}

interface NameListProps {
  items: NameListItem[]
}

/** 아티스트와 장르처럼 이름으로 찾는 목록. */
export function NameList({ items }: NameListProps) {
  const main = useMainScroll()
  const listRef = useRef<HTMLUListElement>(null)
  const scrollMargin = useScrollMargin(listRef)

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => main,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    scrollMargin,
  })

  const entries = useMemo(() => buildIndex(items, (item) => item.name), [items])

  return (
    <div className="flex items-start gap-3">
      <ul ref={listRef} className="relative min-w-0 flex-1" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const { id, name, detail, artId, to } = items[row.index]
          return (
            <li
              key={id}
              className="absolute top-0 left-0 w-full"
              style={{ height: ROW_HEIGHT, transform: `translateY(${row.start - scrollMargin}px)` }}
            >
              <Link to={to} className="flex h-full items-center gap-3 rounded-lg px-2 hover:bg-raised/60">
                <TrackArt artId={artId} className="size-11 rounded-full" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{name}</span>
                  <span className="block truncate text-caption text-muted-foreground">{detail}</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      <IndexRail entries={entries} onSelect={(index) => virtualizer.scrollToIndex(index, { align: 'start' })} />
    </div>
  )
}
