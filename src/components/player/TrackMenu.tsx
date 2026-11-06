import { Ellipsis } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { TrackFile } from '@/lib/folders/types'
import { cn } from '@/lib/utils'
import { addToQueue, playNextInQueue } from '@/stores/player-store'
import { addToPlaylist, openCreatePlaylist, usePlaylists } from '@/stores/playlists-store'

interface TrackMenuProps {
  tracks: TrackFile[]
  label: string
  className?: string
  /** 재생목록 화면의 이동, 제거처럼 화면마다 다른 항목. */
  children?: ReactNode
}

export function TrackMenu({ tracks, label, className, children }: TrackMenuProps) {
  const playlists = usePlaylists((state) => state.playlists)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`더 보기: ${label}`}
            className={cn('text-muted-foreground', className)}
          />
        }
      >
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-56">
        <DropdownMenuItem onClick={() => playNextInQueue(tracks)}>다음에 재생</DropdownMenuItem>
        <DropdownMenuItem onClick={() => addToQueue(tracks)}>대기열에 추가</DropdownMenuItem>
        {children}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>재생목록에 추가</DropdownMenuLabel>
          {playlists.map((playlist) => (
            <DropdownMenuItem key={playlist.id} onClick={() => addToPlaylist(playlist.id, tracks)}>
              <span className="truncate">{playlist.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => openCreatePlaylist(tracks)}>새 재생목록</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
