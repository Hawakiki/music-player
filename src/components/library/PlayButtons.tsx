import { Play, Shuffle } from 'lucide-react'
import { TrackMenu } from '@/components/player/TrackMenu'
import { Button } from '@/components/ui/button'
import type { TrackFile } from '@/lib/folders/types'
import { playList, shufflePlay } from '@/stores/player-store'

interface PlayButtonsProps {
  tracks: TrackFile[]
  label: string
}

export function PlayButtons({ tracks, label }: PlayButtonsProps) {
  return (
    <div className="flex gap-2">
      <Button size="lg" className="px-4" onClick={() => playList(tracks)}>
        <Play fill="currentColor" />
        재생
      </Button>
      <Button variant="secondary" size="lg" className="px-4" onClick={() => shufflePlay(tracks)}>
        <Shuffle />
        셔플
      </Button>
      <TrackMenu tracks={tracks} label={label} className="size-9 bg-raised" />
    </div>
  )
}
