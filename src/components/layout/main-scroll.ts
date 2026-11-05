import { createContext, useContext, useEffect, useState, type RefObject } from 'react'

export const MainScrollContext = createContext<HTMLElement | null>(null)

export function useMainScroll() {
  return useContext(MainScrollContext)
}

/** 가상 목록 위에 있는 내용의 높이. 내용 크기가 바뀔 때마다 다시 잰다. */
export function useScrollMargin(target: RefObject<HTMLElement | null>) {
  const main = useMainScroll()
  const [margin, setMargin] = useState(0)

  useEffect(() => {
    const content = main?.firstElementChild
    if (!main || !content) return

    const observer = new ResizeObserver(() => {
      if (!target.current) return
      const top = target.current.getBoundingClientRect().top
      setMargin(Math.round(top - main.getBoundingClientRect().top + main.scrollTop))
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [main, target])

  return margin
}

export function useElementWidth(target: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    if (!target.current) return

    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(target.current)
    return () => observer.disconnect()
  }, [target])

  return width
}
