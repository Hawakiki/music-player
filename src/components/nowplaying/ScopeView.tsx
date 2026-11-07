import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  SCOPE_FACE,
  createScopeModule,
  type ScopeDrawer,
  type ScopeFrame,
} from '@/components/nowplaying/scope-modules'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { advanceMeter, createMeterReader, getMeterWindow } from '@/lib/player/meter-reader'
import {
  SCOPE_MODULES,
  SPECTRUM_SIZE,
  createSpectrumReader,
  getFrequencyPosition,
  type ScopeModuleId,
} from '@/lib/player/scope'
import { getMeterTap } from '@/lib/player/sound-graph'
import { VU_WINDOW } from '@/lib/player/vu-meter'
import { cn } from '@/lib/utils'
import { usePlayer } from '@/stores/player-store'
import { chooseScopeModule, resetScopeSlots, useSound } from '@/stores/sound-store'

const SLOT_NAMES = ['큰 칸', '왼쪽 칸', '오른쪽 칸']
const FREQUENCY_MARKS = [
  { hz: 100, label: '100' },
  { hz: 1000, label: '1k' },
  { hz: 10000, label: '10k' },
]
const FALLBACK_SAMPLE_RATE = 48000
/** 멈춘 뒤 궤적과 바가 내려앉을 때까지 그린다. */
const SETTLE_SECONDS = 1.2

function getModuleLabel(module: ScopeModuleId) {
  return SCOPE_MODULES.find(({ id }) => id === module)?.label ?? ''
}

interface ScopeSlotProps {
  index: number
  module: ScopeModuleId
  setCanvas: (index: number, canvas: HTMLCanvasElement | null) => void
  className?: string
}

function ScopeSlot({ index, module, setCanvas, className }: ScopeSlotProps) {
  const label = getModuleLabel(module)

  return (
    <div
      data-slot-index={index}
      className={cn('relative min-h-0 min-w-0 overflow-hidden rounded-lg border border-[#2b3036]', className)}
      style={{ backgroundColor: SCOPE_FACE }}
    >
      {/* 칸마다 캔버스를 새로 만들어야 이전 모듈의 그림이 남지 않는다. */}
      <canvas
        key={module}
        ref={(canvas) => setCanvas(index, canvas)}
        data-module={module}
        className="absolute inset-0 size-full"
      />
      {module === 'spectrogram' &&
        FREQUENCY_MARKS.map(({ hz, label: mark }) => (
          <span
            key={hz}
            className="pointer-events-none absolute left-2 -translate-y-1/2 text-[0.6875rem] text-[#9ba1a8]"
            style={{ top: `${(1 - getFrequencyPosition(hz)) * 100}%` }}
          >
            {mark}
          </span>
        ))}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${SLOT_NAMES[index]} 바꾸기: 지금은 ${label}`}
          className="absolute inset-0 flex items-start justify-end p-1.5 text-[#80868e] outline-none hover:text-[#dcdfe3] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <span className="flex items-center gap-0.5 rounded-sm bg-[#14171a]/85 px-1 text-[0.6875rem]">
            {label}
            <ChevronDown className="size-3" />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {SCOPE_MODULES.map(({ id, label: name }) => (
            <DropdownMenuItem key={id} onClick={() => chooseScopeModule(index, id)}>
              <span className="flex-1">{name}</span>
              {id === module && <Check className="size-4" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={resetScopeSlots}>기본값으로</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

interface ScopeViewProps {
  className: string
}

export function ScopeView({ className }: ScopeViewProps) {
  const isPlaying = usePlayer((player) => player.isPlaying)
  const slots = useSound((state) => state.scopeSlots)
  const reference = Number(useSound((state) => state.vuReference))

  const [reader] = useState(createMeterReader)
  const [readSpectrum] = useState(createSpectrumReader)
  const root = useRef<HTMLDivElement>(null)
  const canvases = useRef<(HTMLCanvasElement | null)[]>([null, null, null])
  const drawers = useRef<ScopeDrawer[]>([])
  const spectra = useRef({
    left: new Float32Array(SPECTRUM_SIZE / 2),
    right: new Float32Array(SPECTRUM_SIZE / 2),
    readAt: -1,
    reads: 0,
  })

  const animation = useRef(0)
  const lastFrame = useRef(0)
  const quietSeconds = useRef(0)

  const setCanvas = (index: number, canvas: HTMLCanvasElement | null) => {
    canvases.current[index] = canvas
  }

  // 재생 상태가 바뀌어도 모듈을 다시 만들지 않는다. 다시 만들면 지나간 기록이 지워진다.
  useEffect(() => {
    drawers.current = slots.flatMap((module, index) => {
      const canvas = canvases.current[index]
      return canvas ? [createScopeModule(module, canvas)] : []
    })
  }, [slots])

  useEffect(() => {
    const draw = (now: number) => {
      const seconds = Math.max((now - lastFrame.current) / 1000, 0)
      lastFrame.current = now

      const tap = getMeterTap()
      if (tap) advanceMeter(reader, tap, seconds, now)

      const frame: ScopeFrame = {
        left: getMeterWindow(reader.left, reader, VU_WINDOW),
        right: getMeterWindow(reader.right, reader, VU_WINDOW),
        reader,
        sampleRate: tap?.input.context.sampleRate ?? FALLBACK_SAMPLE_RATE,
        now,
        seconds,
        playing: isPlaying,
        vuReferenceDb: reference,
        spectrum: () => {
          const current = spectra.current
          if (current.readAt !== now) {
            readSpectrum(getMeterWindow(reader.left, reader, SPECTRUM_SIZE), current.left)
            readSpectrum(getMeterWindow(reader.right, reader, SPECTRUM_SIZE), current.right)
            current.readAt = now
            current.reads += 1
            if (root.current) root.current.dataset.spectrumReads = String(current.reads)
          }
          return current
        },
      }
      for (const drawer of drawers.current) drawer(frame)

      // 멈춘 뒤 값이 내려앉으면 그리기를 쉰다.
      quietSeconds.current = isPlaying ? 0 : quietSeconds.current + seconds
      if (quietSeconds.current < SETTLE_SECONDS) animation.current = requestAnimationFrame(draw)
    }

    lastFrame.current = performance.now()
    quietSeconds.current = 0
    animation.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animation.current)
  }, [isPlaying, reference, slots, reader, readSpectrum])

  return (
    <div
      ref={root}
      role="group"
      aria-label="측정"
      data-scope
      className={cn('grid grid-cols-2 grid-rows-[minmax(0,1.75fr)_minmax(0,1fr)] gap-2', className)}
    >
      <ScopeSlot index={0} module={slots[0]} setCanvas={setCanvas} className="col-span-2" />
      <ScopeSlot index={1} module={slots[1]} setCanvas={setCanvas} />
      <ScopeSlot index={2} module={slots[2]} setCanvas={setCanvas} />
    </div>
  )
}
