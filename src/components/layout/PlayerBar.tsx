import {
  Music,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersVertical,
  Volume2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

// 재생 기능은 3단계에서 연결한다. 그때까지 컨트롤은 비활성으로 둔다.
export function PlayerBar() {
  return (
    <section
      aria-label="플레이어"
      className="grid h-18 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t bg-panel px-4 md:h-21 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-12 shrink-0 place-items-center rounded-md bg-raised text-faint md:size-14">
          <Music className="size-5" />
        </div>
        <p className="truncate text-muted-foreground">재생 중인 곡 없음</p>
      </div>

      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-lg" disabled aria-label="셔플" className="hidden md:inline-flex">
            <Shuffle className="size-5" />
          </Button>
          <Button variant="ghost" size="icon-lg" disabled aria-label="이전 곡" className="hidden md:inline-flex">
            <SkipBack className="size-5" fill="currentColor" />
          </Button>
          <Button size="icon-lg" disabled aria-label="재생" className="rounded-full">
            <Play className="size-4.5" fill="currentColor" />
          </Button>
          <Button variant="ghost" size="icon-lg" disabled aria-label="다음 곡" className="hidden md:inline-flex">
            <SkipForward className="size-5" fill="currentColor" />
          </Button>
          <Button variant="ghost" size="icon-lg" disabled aria-label="반복" className="hidden md:inline-flex">
            <Repeat className="size-5" />
          </Button>
        </div>
        <div className="hidden w-full max-w-155 items-center gap-2.5 text-xs text-muted-foreground md:flex">
          <span>0:00</span>
          <div className="h-1 flex-1 rounded-full bg-raised" />
          <span>0:00</span>
        </div>
      </div>

      <div className="hidden items-center justify-end gap-2 md:flex">
        <Button variant="ghost" size="icon-lg" disabled aria-label="이퀄라이저">
          <SlidersVertical className="size-5" />
        </Button>
        <div className="flex w-30 items-center gap-2.5 text-muted-foreground">
          <Volume2 className="size-4.5 shrink-0" />
          <div className="h-1 flex-1 rounded-full bg-raised" />
        </div>
      </div>
    </section>
  )
}
