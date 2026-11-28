/**
 * 章节「已读」标记 + 目录筛选。
 * 已读按章标题存（和书签、阅读位置一个道理：中间插一章，序号就全错位了），本机 localStorage。
 */

/** 目录筛选：关键词不区分大小写匹配章名；纯数字时也当作章序号（输 123 能直接找到第 123 章） */
export function filterToc(titles: string[], query: string): number[] {
  const q = query.trim().toLowerCase()
  if (!q) return titles.map((_, i) => i)
  const asNum = /^\d+$/.test(q) ? Number(q) : null
  const out: number[] = []
  titles.forEach((t, i) => {
    if (t.toLowerCase().includes(q) || (asNum !== null && i + 1 === asNum)) out.push(i)
  })
  return out
}

/** 已读章数 / 总章数，百分比取整 */
export function readPercent(read: ReadonlySet<string>, titles: string[]): number {
  if (!titles.length) return 0
  const n = titles.filter((t) => read.has(t)).length
  return Math.round((n / titles.length) * 100)
}

/** 第一个还没读的章（从头数）；全读完返回 -1 —— 给「继续读未读」用 */
export function firstUnread(read: ReadonlySet<string>, titles: string[]): number {
  return titles.findIndex((t) => !read.has(t))
}

const KEY = (docId: string) => `quill:readch:${docId}`

export function loadRead(docId: string): Set<string> {
  try {
    const j = JSON.parse(localStorage.getItem(KEY(docId)) ?? '[]')
    return new Set(Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function saveRead(docId: string, read: ReadonlySet<string>): void {
  try {
    localStorage.setItem(KEY(docId), JSON.stringify([...read]))
  } catch {
    /* 记不住只是少了灰色标记 */
  }
}
