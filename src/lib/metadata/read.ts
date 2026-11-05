import { parseBlob, selectCover, type IAudioMetadata } from 'music-metadata'
import { hasArt, saveArt } from '@/lib/db'
import type { TrackCover } from '@/lib/folders/types'
import type { ReadJob, ReadResult, ReadTags } from './types'

const THUMBNAIL_SIZE = 384
const THUMBNAIL_QUALITY = 0.85

/** 앨범의 곡마다 같은 cover.jpg를 다시 읽지 않도록 기억한다. */
const coverIds = new Map<string, Promise<string | undefined>>()

async function hashImage(image: Blob) {
  const digest = await crypto.subtle.digest('SHA-1', await image.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 가운데를 잘라서 정사각형 썸네일을 만든다. */
async function createThumbnail(image: Blob) {
  const bitmap = await createImageBitmap(image)
  const side = Math.min(THUMBNAIL_SIZE, bitmap.width, bitmap.height)
  const scale = side / Math.min(bitmap.width, bitmap.height)
  const width = bitmap.width * scale
  const height = bitmap.height * scale

  const canvas = new OffscreenCanvas(side, side)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas is not available')

  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, (side - width) / 2, (side - height) / 2, width, height)
  bitmap.close()

  return canvas.convertToBlob({ type: 'image/jpeg', quality: THUMBNAIL_QUALITY })
}

/** 같은 이미지는 해시로 한 번만 저장한다. 깨진 이미지는 없는 것으로 친다. */
async function storeArt(image: Blob) {
  try {
    const id = await hashImage(image)
    if (!(await hasArt(id))) await saveArt(id, await createThumbnail(image))
    return id
  } catch {
    return undefined
  }
}

async function readCoverFile({ source }: TrackCover) {
  try {
    return await storeArt(source instanceof File ? source : await source.getFile())
  } catch {
    return undefined
  }
}

async function readCover(cover: TrackCover | undefined) {
  if (!cover) return undefined

  const known = await coverIds.get(cover.key)
  if (known && (await hasArt(known))) return known

  const pending = readCoverFile(cover)
  coverIds.set(cover.key, pending)
  return pending
}

function clean(value: string | undefined) {
  return value?.trim() || undefined
}

function toTags({ common, format }: IAudioMetadata): Omit<ReadTags, 'size' | 'lastModified'> {
  const genres = common.genre
    ?.flatMap((genre) => genre.split(';'))
    .map((genre) => genre.trim())
    .filter(Boolean)

  return {
    title: clean(common.title),
    artist: clean(common.artist),
    album: clean(common.album),
    albumArtist: clean(common.albumartist),
    genres: genres?.length ? genres : undefined,
    year: common.year,
    trackNo: common.track.no ?? undefined,
    discNo: common.disk.no ?? undefined,
    duration: format.duration,
    bitrate: format.bitrate,
    sampleRate: format.sampleRate,
    bitsPerSample: format.bitsPerSample,
    codec: format.codec ?? format.container,
    lossless: format.lossless,
  }
}

async function readEmbeddedArt(metadata: IAudioMetadata) {
  const picture = selectCover(metadata.common.picture)
  if (!picture) return undefined

  return storeArt(new Blob([picture.data as Uint8Array<ArrayBuffer>], { type: picture.format }))
}

export async function readTrack({ id, source, cover, known }: ReadJob): Promise<ReadResult> {
  let file: File
  try {
    file = source instanceof File ? source : await source.getFile()
  } catch {
    return { id, kind: 'unavailable' }
  }

  const { size, lastModified } = file
  if (known?.size === size && known.lastModified === lastModified) return { id, kind: 'unchanged' }

  try {
    const metadata = await parseBlob(file)
    const artId = (await readEmbeddedArt(metadata)) ?? (await readCover(cover))
    return { id, kind: 'read', tags: { ...toTags(metadata), size, lastModified, artId } }
  } catch {
    // 태그를 못 읽는 파일도 파일 이름과 폴더 이미지로 라이브러리에 올린다.
    return { id, kind: 'read', tags: { size, lastModified, artId: await readCover(cover) } }
  }
}
