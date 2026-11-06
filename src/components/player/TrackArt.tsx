import type { CSSProperties } from 'react'
import { Music } from 'lucide-react'
import { useArtUrl } from '@/hooks/use-art-url'
import { cn } from '@/lib/utils'

interface TrackArtProps {
  artId?: string
  className?: string
  style?: CSSProperties
}

export function TrackArt({ artId, className, style }: TrackArtProps) {
  const url = useArtUrl(artId)

  if (url) {
    return <img src={url} alt="" style={style} className={cn('shrink-0 rounded-md object-cover', className)} />
  }

  return (
    <div style={style} className={cn('grid shrink-0 place-items-center rounded-md bg-raised text-faint', className)}>
      <Music className="size-5" />
    </div>
  )
}
