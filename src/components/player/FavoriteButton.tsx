import { Heart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TrackFile } from '@/lib/folders/types'
import { cn } from '@/lib/utils'
import { toggleFavorite, useFavorites } from '@/stores/favorites-store'

interface FavoriteButtonProps {
  track: TrackFile
  label: string
  className?: string
}

export function FavoriteButton({ track, label, className }: FavoriteButtonProps) {
  const favorite = useFavorites((state) => state.items[track.id] !== undefined)

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`${favorite ? '즐겨찾기 해제' : '즐겨찾기'}: ${label}`}
      aria-pressed={favorite}
      onClick={() => toggleFavorite(track)}
      className={cn('text-muted-foreground', favorite && 'text-point hover:text-point', className)}
    >
      <Heart fill={favorite ? 'currentColor' : 'none'} />
    </Button>
  )
}
