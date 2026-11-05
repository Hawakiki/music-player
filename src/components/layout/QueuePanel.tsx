import { QueueList } from '@/components/player/QueueList'

export function QueuePanel() {
  return (
    <aside aria-label="대기열" className="hidden w-80 shrink-0 flex-col overflow-y-auto border-l bg-panel p-4 xl:flex">
      <h2 className="px-1 pt-1 pb-3 text-base font-semibold">대기열</h2>
      <QueueList />
    </aside>
  )
}
