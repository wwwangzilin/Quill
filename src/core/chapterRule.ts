/**
 * 自定义章节规则：自动识别认错了章（或根本没认出来）时，让人自己写一条规则。
 *
 * 规则 = 一个正则，对「每一行」去掉首尾空白后匹配，匹配上的行就是一章的开头（整行当章名）。
 * 纯函数，不碰存储 / DOM。
 */

export interface RuleChapter {
  title: string
  /** 字符区间 [from, to) */
  from: number
  to: number
}

/** 章名不会长过这么多个字符：超长的行直接不看，既快又挡掉把整段正文当标题的误伤 */
export const MAX_TITLE = 80

export const PRESETS: { name: string; rule: string }[] = [
  { name: '第X章 / 回 / 节', rule: '^第[0-9０-９一二三四五六七八九十百千零两]+[章节回卷篇]' },
  { name: '1. 标题', rule: '^[0-9]{1,4}\\s*[.．、]\\s*\\S' },
  { name: '【标题】', rule: '^【[^】]{1,30}】$' },
  { name: '=== 标题 ===', rule: '^[=＝\\-—]{3,}\\s*.+?\\s*[=＝\\-—]{3,}$' },
  { name: 'Chapter N', rule: '^chapter\\s+([0-9]+|[ivxlcdm]+)\\b' },
]

/** 编译规则；空或写错返回 null（界面据此给红框） */
export function compileRule(src: string): RegExp | null {
  const s = src.trim()
  if (!s) return null
  try {
    return new RegExp(s, 'iu')
  } catch {
    return null
  }
}

/** 一行是不是章名；是就返回去掉 Markdown 标题标记的干净名字 */
function titleOf(line: string, re: RegExp): string | null {
  if (line.length > MAX_TITLE * 2) return null
  const t = line.trim()
  if (!t || t.length > MAX_TITLE) return null
  const bare = t.replace(/^#{1,6}\s+/, '')
  return re.test(bare) ? bare : null
}

/** 在整篇原文上切章（字符区间）。没有一行命中就整篇当一章 */
export function splitByRule(text: string, re: RegExp, fallbackTitle: string): RuleChapter[] {
  const marks: { title: string; at: number }[] = []
  let start = 0
  const len = text.length
  while (start <= len) {
    let end = text.indexOf('\n', start)
    if (end < 0) end = len
    if (end - start <= MAX_TITLE * 2) {
      const title = titleOf(text.slice(start, end), re)
      if (title) marks.push({ title, at: start })
    }
    if (end >= len) break
    start = end + 1
  }
  if (!marks.length) return [{ title: fallbackTitle, from: 0, to: len }]
  // 第一个命中之前如果有正文（序言、简介），单独成一章，不丢
  const out: RuleChapter[] = []
  if (marks[0].at > 0 && text.slice(0, marks[0].at).trim()) out.push({ title: fallbackTitle, from: 0, to: marks[0].at })
  marks.forEach((m, i) => out.push({ title: m.title, from: m.at, to: i + 1 < marks.length ? marks[i + 1].at : len }))
  return out
}

/** 字符区间 → 字节区间（UTF-8）。超大文档按字节读盘，所以要换算；一趟扫描，不重复编码 */
export function toByteRanges(text: string, chapters: RuleChapter[]): RuleChapter[] {
  const enc = new TextEncoder()
  let charAt = 0
  let byteAt = 0
  const bytePos = (char: number) => {
    if (char > charAt) {
      byteAt += enc.encode(text.slice(charAt, char)).length
      charAt = char
    }
    return byteAt
  }
  // 章是连续、递增的，所以 from / to 依次取就是一趟走完
  return chapters.map((c) => {
    const from = bytePos(c.from)
    const to = bytePos(c.to)
    return { title: c.title, from, to }
  })
}

/** 非超大文档：每个顶层块一段文字，命中的块开新章。返回每章的块区间 [startBlock, endBlock) */
export function splitBlocksByRule(
  blockTexts: string[],
  re: RegExp,
  fallbackTitle: string,
): { title: string; startBlock: number; endBlock: number }[] {
  const marks: { title: string; at: number }[] = []
  blockTexts.forEach((t, i) => {
    const title = titleOf(t, re)
    if (title) marks.push({ title, at: i })
  })
  const n = blockTexts.length
  if (!marks.length) return [{ title: fallbackTitle, startBlock: 0, endBlock: n }]
  const out: { title: string; startBlock: number; endBlock: number }[] = []
  if (marks[0].at > 0) out.push({ title: fallbackTitle, startBlock: 0, endBlock: marks[0].at })
  marks.forEach((m, i) => out.push({ title: m.title, startBlock: m.at, endBlock: i + 1 < marks.length ? marks[i + 1].at : n }))
  return out
}

export interface RulePreview {
  count: number
  samples: string[]
  /** 平均每章多少字；太小（<200）多半是误伤了正文里的句子 */
  avgLen: number
}

export function previewRule(chapters: RuleChapter[], sample = 6): RulePreview {
  const count = chapters.length
  const total = chapters.reduce((n, c) => n + (c.to - c.from), 0)
  return { count, samples: chapters.slice(0, sample).map((c) => c.title), avgLen: count ? Math.round(total / count) : 0 }
}

const KEY = (docId: string) => `quill:chaprule:${docId}`
export function loadRule(docId: string): string {
  try {
    return localStorage.getItem(KEY(docId)) ?? ''
  } catch {
    return ''
  }
}
export function saveRule(docId: string, rule: string): void {
  try {
    if (rule.trim()) localStorage.setItem(KEY(docId), rule.trim())
    else localStorage.removeItem(KEY(docId))
  } catch {
    /* 记不住就算了 */
  }
}
