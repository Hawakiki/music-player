import type { CSSProperties } from 'react'
import { useArtTint } from '@/hooks/use-art-tint'
import { cn } from '@/lib/utils'

interface ArtBackdropProps {
  artId: string | undefined
  className?: string
}

/** 표지 색을 위에서 아래로 옅게 깐다. 감싸는 요소에 `relative isolate`가 있어야 내용 뒤로 깔린다. */
export function ArtBackdrop({ artId, className }: ArtBackdropProps) {
  const tint = useArtTint(artId)
  const style = tint
    ? ({ '--art-h': tint.hue, '--art-c': tint.chroma, '--art-dark-scale': tint.darkScale } as CSSProperties)
    : undefined

  return (
    <div
      aria-hidden
      data-art-backdrop
      data-tinted={tint ? '' : undefined}
      style={style}
      className={cn('art-backdrop pointer-events-none absolute -z-10', className)}
    />
  )
}
