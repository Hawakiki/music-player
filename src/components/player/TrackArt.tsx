import { Music } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TrackArtProps {
  className?: string
}

export function TrackArt({ className }: TrackArtProps) {
  return (
    <div className={cn('grid shrink-0 place-items-center rounded-md bg-raised text-faint', className)}>
      <Music className="size-5" />
    </div>
  )
}
