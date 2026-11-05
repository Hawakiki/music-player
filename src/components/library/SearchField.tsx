import { Search } from 'lucide-react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { cn } from '@/lib/utils'

interface SearchFieldProps {
  className?: string
}

export function SearchField({ className }: SearchFieldProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const onSearchPage = pathname === '/search'

  return (
    <label className={cn('flex h-9 items-center gap-2 rounded-lg bg-raised px-2.5 text-muted-foreground', className)}>
      <Search className="size-4 shrink-0" />
      <input
        type="search"
        placeholder="검색"
        aria-label="검색"
        value={onSearchPage ? (params.get('q') ?? '') : ''}
        onChange={(event) =>
          navigate(`/search?q=${encodeURIComponent(event.target.value)}`, { replace: onSearchPage })
        }
        className="w-full min-w-0 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  )
}
