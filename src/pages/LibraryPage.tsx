import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { NavItem } from '@/lib/navigation'

interface LibraryPageProps {
  item: NavItem
}

export function LibraryPage({ item }: LibraryPageProps) {
  const { label, empty, icon: Icon } = item

  return (
    <div className="flex h-full flex-col">
      <h1 className="text-title font-semibold">{label}</h1>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-16 text-center">
        <Icon className="size-8 text-faint" />
        <p className="text-muted-foreground">{empty}</p>
        <Button variant="secondary" size="lg" disabled className="mt-1 px-4">
          <Plus />
          폴더 추가
        </Button>
      </div>
    </div>
  )
}
