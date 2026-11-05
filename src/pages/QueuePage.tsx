import { QueueList } from '@/components/player/QueueList'

export function QueuePage() {
  return (
    <div className="max-w-3xl">
      <h1 className="pb-4 text-title font-semibold">대기열</h1>
      <QueueList />
    </div>
  )
}
