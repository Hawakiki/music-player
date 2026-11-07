import { Music, Search, Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { NoticeToast } from '@/components/layout/NoticeToast'
import { CassetteView } from '@/components/nowplaying/CassetteView'
import { EqPanel } from '@/components/nowplaying/EqPanel'
import { LpView } from '@/components/nowplaying/LpView'
import { ScopeView } from '@/components/nowplaying/ScopeView'
import { SoundPanel } from '@/components/nowplaying/SoundPanel'
import { TrackInfoPanel } from '@/components/nowplaying/TrackInfoPanel'
import { VuMeter } from '@/components/nowplaying/VuMeter'
import { WaveSeek } from '@/components/nowplaying/WaveSeek'
import { ArtBackdrop } from '@/components/player/ArtBackdrop'
import { FavoriteButton } from '@/components/player/FavoriteButton'
import { QueueList } from '@/components/player/QueueList'
import { TrackMenu } from '@/components/player/TrackMenu'
import { TransportControls } from '@/components/player/TransportControls'
import { VolumeControl } from '@/components/player/VolumeControl'
import { CreatePlaylistDialog } from '@/components/playlists/CreatePlaylistDialog'
import { buttonVariants } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useArtUrl } from '@/hooks/use-art-url'
import { useFullCover } from '@/hooks/use-full-cover'
import { useLibraryIndex } from '@/hooks/use-library-index'
import { usePlayerShortcuts } from '@/hooks/use-player-shortcuts'
import type { TrackFile } from '@/lib/folders/types'
import { formatLabel } from '@/lib/metadata/format'
import type { TrackMeta } from '@/lib/metadata/types'
import { getOutputSampleRate } from '@/lib/player/sound-graph'
import { trackTitle } from '@/lib/tracks'
import { cn } from '@/lib/utils'
import { useMetadata } from '@/stores/metadata-store'
import { usePlayer } from '@/stores/player-store'
import { useSound } from '@/stores/sound-store'

const COVER_DESKTOP = 'lg:h-[min(32.5rem,calc(100dvh-23rem))] lg:w-auto lg:max-w-none'
const COVER_SIZE = `aspect-square w-full max-w-sm ${COVER_DESKTOP}`
/** 카세트는 휴대폰에서 세로로 길게 서므로 정사각형으로 묶지 않는다. */
const CASSETTE_SIZE = `w-full max-w-sm lg:aspect-square ${COVER_DESKTOP}`

const TAB = 'flex-none px-0 after:bg-point'
const ENTER = 'animate-in duration-300 fade-in motion-reduce:animate-none'

/** 움직임을 줄이면 애니메이션이 끝났다는 신호가 없으므로 앞 표지를 기다리지 않고 바로 치운다. */
function prefersReducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 화면을 연 뒤 곡이 한 번이라도 바뀌었는지. 화면을 열 때는 나타나는 효과를 주지 않는다. */
function useTrackChanged(id: string | undefined) {
  const [first] = useState(id)
  const [changed, setChanged] = useState(false)
  if (!changed && id !== first) setChanged(true)
  return changed
}

function isPanelTab(value: string | null) {
  return value === 'queue' || value === 'eq' || value === 'sound' || value === 'info'
}

interface CoverProps {
  track: TrackFile | undefined
  artId: string | undefined
}

interface CoverLayer {
  id: string
  url: string | null
}

/**
 * 곡이 바뀌면 새 표지를 앞 표지 위로 겹쳐 띄운다. 앞 표지는 그동안 밑에 남아 있다.
 * 같은 곡에서 썸네일이 원본으로 바뀌는 것은 겹치지 않고 그대로 바꾼다.
 */
function Cover({ track, artId }: CoverProps) {
  const full = useFullCover(track)
  const thumbnail = useArtUrl(artId)
  const id = track?.id ?? ''
  const url = full ?? thumbnail
  const [layers, setLayers] = useState<CoverLayer[]>([{ id, url }])
  const top = layers[layers.length - 1]
  if (top.id !== id) setLayers(prefersReducedMotion() ? [{ id, url }] : [top, { id, url }])
  else if (top.url !== url) setLayers([...layers.slice(0, -1), { id, url }])

  return (
    <div data-cover className={`${COVER_SIZE} relative shrink-0 overflow-hidden rounded-lg bg-raised`}>
      {layers.map((layer, index) => {
        const entering = index > 0
        const className = cn('absolute inset-0 size-full', entering && ENTER)
        const settle = entering ? () => setLayers((current) => current.slice(-1)) : undefined
        return layer.url ? (
          <img key={layer.id} src={layer.url} alt="" onAnimationEnd={settle} className={cn(className, 'object-cover')} />
        ) : (
          <div key={layer.id} onAnimationEnd={settle} className={cn(className, 'grid place-items-center bg-raised text-faint')}>
            <Music className="size-5" />
          </div>
        )
      })}
    </div>
  )
}

interface CoverSpotProps {
  track: TrackFile | undefined
  meta: TrackMeta | undefined
  title: string
}

function CoverSpot({ track, meta, title }: CoverSpotProps) {
  const artId = meta?.artId
  const view = useSound((sound) => sound.coverView)

  if (view === 'vu') return <VuMeter className={COVER_SIZE} />
  if (view === 'scope') return <ScopeView className={COVER_SIZE} />
  if (view === 'cassette') {
    return <CassetteView title={title} fileName={track?.name ?? ''} meta={meta} className={CASSETTE_SIZE} />
  }
  if (view === 'lp') return <LpView artId={artId} className={COVER_SIZE} />
  return <Cover track={track} artId={artId} />
}

function formatKhz(sampleRate: number) {
  return `${sampleRate / 1000} kHz`
}

interface AudioSpecProps {
  meta: TrackMeta | undefined
}

function AudioSpec({ meta }: AudioSpecProps) {
  const output = useMemo(() => getOutputSampleRate(), [])
  const format = meta && formatLabel(meta)
  const bitrate = meta?.lossless && meta.bitrate ? `, ${Math.round(meta.bitrate / 1000).toLocaleString('ko-KR')} kbps` : ''

  return (
    <dl className="m-0 grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 border-t pt-3 text-caption">
      {format && (
        <>
          <dt className="text-faint">파일</dt>
          <dd className="m-0 text-muted-foreground">
            {format}
            {bitrate}
          </dd>
        </>
      )}
      <dt className="text-faint">출력</dt>
      <dd className="m-0 text-muted-foreground">{formatKhz(output)}, 시스템 기본 장치</dd>
    </dl>
  )
}

export function NowPlayingPage() {
  usePlayerShortcuts()

  const [params, setParams] = useSearchParams()
  const { state } = useLocation() as { state: { from?: string } | null }
  const requested = params.get('tab')
  const tab = isPanelTab(requested) ? requested : 'queue'

  const track = usePlayer((player) => player.queue[player.index])
  const next = usePlayer((player) => player.queue[player.index + 1])
  const meta = useMetadata((metadata) => (track ? metadata.items[track.id] : undefined))
  const nextMeta = useMetadata((metadata) => (next ? metadata.items[next.id] : undefined))
  const { albumByTrack } = useLibraryIndex()
  const album = track && albumByTrack.get(track.id)
  const format = meta && formatLabel(meta)
  const title = track ? trackTitle(track, meta) : '재생 중인 곡 없음'
  // 표지가 보이는 표시에서만 표지 색을 깐다. 계측기 뒤에 색이 깔리면 근거 없는 색이 된다.
  const showsArt = useSound((sound) => sound.coverView === 'art' || sound.coverView === 'lp')
  const trackChanged = useTrackChanged(track?.id)

  return (
    <div className="flex h-dvh flex-col">
      <nav
        aria-label="화면"
        className="flex h-14 shrink-0 items-center gap-8 border-b bg-panel px-4 font-medium md:px-8"
      >
        <Link to={state?.from ?? '/albums'} className="text-muted-foreground hover:text-foreground">
          라이브러리
        </Link>
        <span aria-current="page" className="relative flex h-full items-center">
          재생
          <span className="absolute inset-x-0 -bottom-px h-0.5 bg-point" />
        </span>
        <div className="ml-auto flex gap-1">
          <Link to="/search" aria-label="검색" className={buttonVariants({ variant: 'ghost', size: 'icon-lg' })}>
            <Search className="size-5" />
          </Link>
          <Link to="/settings" aria-label="설정" className={buttonVariants({ variant: 'ghost', size: 'icon-lg' })}>
            <Settings2 className="size-5" />
          </Link>
        </div>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_27.5rem] lg:overflow-hidden">
        <main className="relative isolate flex min-w-0 flex-col gap-6 px-4 py-6 md:px-10 lg:overflow-y-auto lg:py-8">
          <ArtBackdrop artId={showsArt ? meta?.artId : undefined} className="inset-0" />
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:gap-10">
            <CoverSpot track={track} meta={meta} title={title} />
            <div className="min-w-0 flex-1 pb-1">
              <div key={track?.id} className={trackChanged ? ENTER : undefined}>
                <h1 className="text-4xl leading-tight font-semibold">{title}</h1>
                {meta?.artist && <p className="mt-1 text-lg text-muted-foreground">{meta.artist}</p>}
                {album && (
                  <Link to={`/albums/${album.id}`} className="text-faint hover:text-foreground">
                    {album.title}
                    {album.year ? `, ${album.year}` : ''}
                  </Link>
                )}
              </div>
              {format && (
                <p className="mt-4">
                  <span className="rounded-sm bg-raised px-2 py-0.5 text-xs text-muted-foreground">{format}</span>
                </p>
              )}
              {next && (
                <div className="mt-6 border-t pt-3">
                  <p className="text-xs text-faint">다음 곡</p>
                  <p className="truncate font-medium">{trackTitle(next, nextMeta)}</p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-auto">
            <WaveSeek track={track} />
            <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div className="flex items-center gap-1">
                {track && <FavoriteButton track={track} label={title} />}
                {track && <TrackMenu tracks={[track]} label={title} />}
              </div>
              <TransportControls large />
              <div className="hidden justify-end md:flex">
                <VolumeControl />
              </div>
            </div>
          </div>
        </main>

        <aside className="flex min-h-0 flex-col border-t bg-panel lg:border-t-0 lg:border-l">
          <Tabs
            value={tab}
            onValueChange={(value) => setParams({ tab: String(value) }, { replace: true, state })}
            className="min-h-0 flex-1 gap-0"
          >
            <TabsList variant="line" className="h-12 w-full justify-start gap-5 rounded-none border-b px-6">
              <TabsTrigger value="queue" className={TAB}>
                대기열
              </TabsTrigger>
              <TabsTrigger value="eq" className={TAB}>
                이퀄라이저
              </TabsTrigger>
              <TabsTrigger value="sound" className={TAB}>
                음향
              </TabsTrigger>
              <TabsTrigger value="info" className={TAB}>
                곡 정보
              </TabsTrigger>
            </TabsList>
            <TabsContent value="queue" className="min-h-0 overflow-y-auto p-4">
              <QueueList />
            </TabsContent>
            <TabsContent value="eq" className="min-h-0 overflow-y-auto px-6 py-4">
              <EqPanel />
            </TabsContent>
            <TabsContent value="sound" className="min-h-0 overflow-y-auto px-6 py-4">
              <SoundPanel />
            </TabsContent>
            <TabsContent value="info" className="min-h-0 overflow-y-auto px-6 py-4">
              <TrackInfoPanel track={track} meta={meta} />
            </TabsContent>
          </Tabs>
          <div className="shrink-0 px-6 pb-5">
            <AudioSpec meta={meta} />
          </div>
        </aside>
      </div>

      <NoticeToast />
      <CreatePlaylistDialog />
    </div>
  )
}
