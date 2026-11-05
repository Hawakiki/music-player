import { readTrack } from '@/lib/metadata/read'
import type { ReadJob } from '@/lib/metadata/types'

self.addEventListener('message', (event: MessageEvent<ReadJob>) => {
  void readTrack(event.data).then((result) => self.postMessage(result))
})
