import { useEffect } from 'react'
import { clearNotice, useLibrary } from '@/stores/library-store'

const VISIBLE_MS = 5000

export function NoticeToast() {
  const notice = useLibrary((state) => state.notice)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => clearNotice(notice.id), VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  return (
    <div role="status" className="pointer-events-none fixed inset-x-4 bottom-36 z-40 flex justify-center md:bottom-24">
      {notice && <p className="rounded-lg border bg-raised px-4 py-2.5 shadow-md">{notice.text}</p>}
    </div>
  )
}
