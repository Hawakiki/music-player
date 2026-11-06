import { useEffect, useRef, type RefObject } from 'react'
import { useReducedMotion } from '@/hooks/use-media-query'

const SETTLED_RATE = 0.002

/** playbackRate에 대입하면 매번 현재 시각을 다시 찾아가서 가속 중에 멈칫한다. */
function setSpinRate(animation: Animation, rate: number) {
  if (rate === 0) {
    animation.pause()
    return
  }

  animation.updatePlaybackRate(rate)
  if (animation.playState !== 'running') animation.play()
}

interface SpinOptions {
  turnsPerSecond: number
  /** 360이면 시계 방향, -360이면 반시계 방향이다. */
  degrees: number
  /** 속도가 바뀔 때의 관성. */
  settleSeconds: number
}

/**
 * 회전을 합성기에 맡겨서 매 프레임 그리지 않는다. 시간을 쌓아서 도는 것이라 탐색해도 튀지 않는다.
 * 움직임 줄이기를 켠 기기에서는 돌지 않는다.
 */
export function useSpin(element: RefObject<HTMLElement | null>, { turnsPerSecond, degrees, settleSeconds }: SpinOptions) {
  const target = useReducedMotion() ? 0 : turnsPerSecond

  const spin = useRef<Animation | null>(null)
  const rate = useRef(0)
  const lastFrame = useRef(0)
  const ramp = useRef(0)

  useEffect(() => {
    const animation = element.current?.animate(
      [{ transform: 'rotate(0deg)' }, { transform: `rotate(${degrees}deg)` }],
      { duration: 1000, iterations: Infinity },
    )
    if (!animation) return

    animation.pause()
    spin.current = animation
    return () => animation.cancel()
  }, [element, degrees])

  useEffect(() => {
    lastFrame.current = performance.now()

    const step = (now: number) => {
      // 첫 프레임의 시각은 effect가 실행된 시각보다 이를 수 있다. 음수면 거꾸로 돈다.
      const seconds = Math.max((now - lastFrame.current) / 1000, 0)
      lastFrame.current = now

      rate.current += (target - rate.current) * (1 - Math.exp(-seconds / settleSeconds))
      if (Math.abs(target - rate.current) < SETTLED_RATE) rate.current = target
      if (spin.current) setSpinRate(spin.current, rate.current)

      if (rate.current !== target) ramp.current = requestAnimationFrame(step)
    }

    ramp.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(ramp.current)
  }, [target, settleSeconds])
}
