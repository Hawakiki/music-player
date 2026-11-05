const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
const DOUBLED: Record<string, string> = { ㄲ: 'ㄱ', ㄸ: 'ㄷ', ㅃ: 'ㅂ', ㅆ: 'ㅅ', ㅉ: 'ㅈ' }

const HANGUL_START = 0xac00
const HANGUL_END = 0xd7a3
const SYLLABLES_PER_INITIAL = 588

/** 인덱스에 쓸 첫 글자를 고른다. 한글은 초성, 영문은 대문자, 나머지는 #이다. */
export function getInitial(name: string) {
  const first = name.trim().charAt(0)
  const code = first.charCodeAt(0)

  if (code >= HANGUL_START && code <= HANGUL_END) {
    const initial = CHOSEONG[Math.floor((code - HANGUL_START) / SYLLABLES_PER_INITIAL)]
    return DOUBLED[initial] ?? initial
  }
  if (CHOSEONG.includes(first)) return DOUBLED[first] ?? first
  return /[a-z]/i.test(first) ? first.toUpperCase() : '#'
}

export interface IndexEntry {
  label: string
  index: number
}

/** 정렬된 목록에서 각 첫 글자가 처음 나오는 위치를 찾는다. */
export function buildIndex<T>(items: T[], getName: (item: T) => string) {
  const seen = new Set<string>()
  const entries: IndexEntry[] = []

  items.forEach((item, index) => {
    const label = getInitial(getName(item))
    if (seen.has(label)) return
    seen.add(label)
    entries.push({ label, index })
  })

  return entries
}
