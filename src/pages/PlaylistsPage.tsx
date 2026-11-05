import { ListMusic } from 'lucide-react'
import { PageHeader } from '@/components/library/PageHeader'

export function PlaylistsPage() {
  return (
    <>
      <PageHeader title="재생목록" />
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <ListMusic className="size-8 text-faint" />
        <p className="text-muted-foreground">재생목록 만들기는 준비 중입니다.</p>
      </div>
    </>
  )
}
