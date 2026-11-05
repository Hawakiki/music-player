import { Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { buttonVariants } from '@/components/ui/button'
import { formatCount } from '@/lib/folders/status'
import { useMetadata } from '@/stores/metadata-store'

function ReadingStatus() {
  const total = useMetadata((state) => state.total)
  const done = useMetadata((state) => state.done)
  if (total === 0) return null

  return (
    <span className="text-caption text-faint">
      곡 정보 읽는 중 {formatCount(done)} / {formatCount(total)}
    </span>
  )
}

interface PageHeaderProps {
  title: string
  count?: string
  children?: ReactNode
}

export function PageHeader({ title, count, children }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-5">
      <h1 className="text-title font-semibold">{title}</h1>
      {count && <span className="text-muted-foreground">{count}</span>}
      <ReadingStatus />
      <div className="ml-auto flex items-center gap-2">
        {children}
        <Link
          to="/search"
          aria-label="검색"
          className={buttonVariants({ variant: 'ghost', size: 'icon-lg', className: 'md:hidden' })}
        >
          <Search className="size-5" />
        </Link>
      </div>
    </div>
  )
}
