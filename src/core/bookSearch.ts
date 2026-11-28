/**
 * 全书搜索（阅读器里）：在每章的「拍平文字」里找关键词，按章分组。
 *
 * 为什么搜拍平文字而不是原始 Markdown：命中的下标要能直接对回渲染出来的页面
 * （批注底纹就是靠同一套下标切的），原文里的 `**`、`[]()` 会让下标对不上。
 * 纯函数，不碰 DOM，node 下可测。
 */

export interface TextRange {
  from: number
  to: number
}

export interface BookHit extends TextRange {
  /** 命中前后的上下文，界面里把 mid 高亮 */
  pre: string
  mid: string
  post: string
}

export interface ChapterHits {
  ci: number
  title: string
  hits: BookHit[]
}

export interface BookSearchResult {
  groups: ChapterHits[]
  /** 一共找到多少处（被 limit 截断时是「已找到的」） */
  total: number
  truncated: boolean
}

/** 不区分大小写的字面量搜索，不重叠；空查询返回空 */
export function findAll(text: string, query: string, limit = Infinity): TextRange[] {
  const q = query.trim()
  if (!q || !text) return []
  const hay = text.toLowerCase()
  const needle = q.toLowerCase()
  // toLowerCase 个别字符会改变长度（如 İ），那样下标就错位了 —— 直接放弃大小写折叠
  const safe = hay.length === text.length && needle.length === q.length
  const H = safe ? hay : text
  const N = safe ? needle : q
  const out: TextRange[] = []
  let at = H.indexOf(N)
  while (at >= 0 && out.length < limit) {
    out.push({ from: at, to: at + N.length })
    at = H.indexOf(N, at + N.length)
  }
  return out
}

export function snippetOf(text: string, r: TextRange, radius = 18): Pick<BookHit, 'pre' | 'mid' | 'post'> {
  const clean = (s: string) => s.replace(/\s+/g, ' ')
  const a = Math.max(0, r.from - radius)
  const b = Math.min(text.length, r.to + radius)
  return {
    pre: (a > 0 ? '…' : '') + clean(text.slice(a, r.from)),
    mid: clean(text.slice(r.from, r.to)),
    post: clean(text.slice(r.to, b)) + (b < text.length ? '…' : ''),
  }
}

/** 单章：返回这一章的命中（最多 limit 条） */
export function searchChapter(text: string, query: string, limit = Infinity): BookHit[] {
  return findAll(text, query, limit).map((r) => ({ ...r, ...snippetOf(text, r) }))
}

/**
 * 全书合并。texts[i] 可以是 undefined（那一章还没取到文字），跳过。
 * limit 是总上限：到了就停，界面提示「只显示前 N 条」。
 */
export function mergeHits(
  titles: string[],
  texts: (string | undefined)[],
  query: string,
  limit = 300,
): BookSearchResult {
  const groups: ChapterHits[] = []
  let total = 0
  let truncated = false
  for (let ci = 0; ci < texts.length; ci += 1) {
    const t = texts[ci]
    if (t === undefined) continue
    const room = limit - total
    if (room <= 0) {
      truncated = true
      break
    }
    // 多取一条，用来判断是不是被截断了
    const hits = searchChapter(t, query, room + 1)
    if (!hits.length) continue
    if (hits.length > room) {
      truncated = true
      hits.length = room
    }
    total += hits.length
    groups.push({ ci, title: titles[ci] ?? `第 ${ci + 1} 节`, hits })
  }
  return { groups, total, truncated }
}

/** 拍平下标 → 它落在第几个顶层块里、块内第几个字。offsets 是每块的起始下标（升序） */
export function locateBlock(offsets: number[], at: number): { block: number; local: number } {
  let lo = 0
  let hi = offsets.length - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid] <= at) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return { block: ans, local: at - (offsets[ans] ?? 0) }
}
