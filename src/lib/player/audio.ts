export const audio = new Audio()
audio.preload = 'auto'

let objectUrl: string | null = null

export function hasSource() {
  return objectUrl !== null
}

export function setSource(file: File) {
  const previous = objectUrl
  objectUrl = URL.createObjectURL(file)
  audio.src = objectUrl
  if (previous) URL.revokeObjectURL(previous)
}

export function clearSource() {
  const previous = objectUrl
  objectUrl = null
  audio.removeAttribute('src')
  audio.load()
  if (previous) URL.revokeObjectURL(previous)
}
