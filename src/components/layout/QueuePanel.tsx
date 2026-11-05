export function QueuePanel() {
  return (
    <aside aria-label="대기열" className="hidden w-80 shrink-0 flex-col border-l bg-panel p-4 xl:flex">
      <h2 className="px-1 pt-1 pb-3 text-base font-semibold">대기열</h2>
      <p className="px-1 text-muted-foreground">재생할 곡을 고르면 여기에 표시됩니다.</p>
    </aside>
  )
}
