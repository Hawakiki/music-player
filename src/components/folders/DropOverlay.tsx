import { useEffect, useState } from 'react'
import { addFromDrop } from '@/stores/library-store'

function hasFiles(event: DragEvent) {
  return event.dataTransfer?.types.includes('Files') ?? false
}

export function DropOverlay() {
  const [active, setActive] = useState(false)

  useEffect(() => {
    // 자식 요소를 지날 때도 dragleave가 나므로 깊이를 세어서 창을 벗어났는지 판단한다.
    let depth = 0

    function onDragEnter(event: DragEvent) {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth += 1
      setActive(true)
    }

    function onDragOver(event: DragEvent) {
      if (!hasFiles(event)) return
      event.preventDefault()
    }

    function onDragLeave(event: DragEvent) {
      if (!hasFiles(event)) return
      depth -= 1
      if (depth <= 0) {
        depth = 0
        setActive(false)
      }
    }

    function onDrop(event: DragEvent) {
      if (!hasFiles(event) || !event.dataTransfer) return
      event.preventDefault()
      depth = 0
      setActive(false)
      void addFromDrop(event.dataTransfer)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  if (!active) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-background/85 p-6">
      <div className="rounded-lg border-2 border-dashed border-point px-10 py-8 text-center">
        <p className="text-base font-semibold">여기에 놓으면 추가됩니다</p>
        <p className="mt-1 text-muted-foreground">폴더나 오디오 파일을 놓으세요.</p>
      </div>
    </div>
  )
}
