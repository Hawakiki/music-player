import type { TrackFile } from '@/lib/folders/types'
import { formatTime } from '@/lib/format'
import type { TrackMeta } from '@/lib/metadata/types'
import { trackTitle } from '@/lib/tracks'

function formatSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

interface TrackInfoPanelProps {
  track: TrackFile | undefined
  meta: TrackMeta | undefined
}

export function TrackInfoPanel({ track, meta }: TrackInfoPanelProps) {
  if (!track) return <p className="text-muted-foreground">재생할 곡을 고르면 곡 정보가 표시됩니다.</p>

  const rows: [string, string | number | undefined][] = [
    ['제목', trackTitle(track, meta)],
    ['아티스트', meta?.artist],
    ['앨범', meta?.album],
    ['앨범 아티스트', meta?.albumArtist],
    ['장르', meta?.genres?.join(', ')],
    ['연도', meta?.year],
    ['트랙', meta?.trackNo],
    ['디스크', meta?.discNo],
    ['길이', meta?.duration ? formatTime(meta.duration) : undefined],
    ['크기', meta ? formatSize(meta.size) : undefined],
    ['경로', track.path],
  ]

  return (
    <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2.5">
      {rows.map(
        ([label, value]) =>
          value !== undefined && (
            <div key={label} className="contents">
              <dt className="text-faint">{label}</dt>
              <dd className="m-0 break-words">{value}</dd>
            </div>
          ),
      )}
    </dl>
  )
}
