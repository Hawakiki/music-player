import { readFullCover, readTrack } from '@/lib/metadata/read'
import type { WorkerJob } from '@/lib/metadata/types'

self.addEventListener('message', ({ data }: MessageEvent<WorkerJob>) => {
  const reading = data.kind === 'cover' ? readFullCover(data) : readTrack(data)
  void reading.then((result) => self.postMessage(result))
})
