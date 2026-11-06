import { useState } from 'react'
import { seek, usePlayer } from '@/stores/player-store'

function firstValue(value: number | readonly number[]) {
  return typeof value === 'number' ? value : value[0]
}

export function useSeek() {
  const position = usePlayer((state) => state.position)
  const duration = usePlayer((state) => state.duration)
  // 끄는 동안에는 재생 위치 대신 손가락이 있는 위치를 보여 준다.
  const [dragging, setDragging] = useState<number | null>(null)

  return {
    shown: dragging ?? position,
    duration,
    onValueChange: (value: number | readonly number[]) => setDragging(firstValue(value)),
    onValueCommitted: (value: number | readonly number[]) => {
      seek(firstValue(value))
      setDragging(null)
    },
  }
}
