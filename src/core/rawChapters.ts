/**
 * 在**原文**上切章。
 *
 * 为什么不复用 chapters.ts 的 extractChapters：那个吃的是解析好的 JSONContent。
 * 一篇 700 万字的文档，光「解析成 JSON」就是二十多万个块 —— 在轮到切章之前
 * 就已经卡死了。这里只扫一遍字符串，**不建任何对象图**，也不预先切片
 * （每章只记 from/to 两个下标，用的时候再 slice）。
 */

export interface RawChapter {
  title: string
  /** 在原文里的字符区间，[from, to) */
  from: number
  to: number
}

/** 「第一章」「第 12 节」—— 只认开头 */
const CN_HEAD = /^第\s*[0-9０-９一二三四五六七八九十百千零两]+\s*[章节回卷篇話话部]/
/** Chapter 1 / CHAPTER IV */
const EN_HEAD = /^chapter\s+([0-9]+|[ivxlcdm]+)\b/i
/** 章名后面常跟着的元信息 */
const META_TAIL = /(作者|更新时间|字数|来源|本章|链接|简介|标签)\s*[:：]/

/** 章名不会长过这么多个字符 */
const MAX_HEAD = 64

/** 行里有没有章节标题？有就把干净的标题返回去 */
function headOf(line: string): string | null {
  /*
   * **先看长度**。小说正文段落动辄几百字，占全部行的九成以上 ——
   * 让它们先过一遍正则是纯浪费。章名不会长过一行这么点，
   * 按长度一刀就能切掉绝大多数，剩下的才值得进正则。
   */
  if (line.length > MAX_HEAD) return null
  const t = line.trim()
  if (!t) return null
  // 去掉 md 标题标记再判断（`#` 是 35）
  const bare = t.charCodeAt(0) === 35 ? t.replace(/^#{1,6}\s+/, '') : t
  if (!CN_HEAD.test(bare) && !EN_HEAD.test(bare)) return null
  // 章名后面常跟着「作者：」「更新时间：」甚至正文第一句，裁掉
  const cut = bare.search(META_TAIL)
  return (cut > 0 ? bare.slice(0, cut) : bare).trim()
}

/**
 * 一行一行地扫，**手动找换行，不用正则**。
 *
 * 原来写的是 `/^[^\n]*$/gm` 那种逐行匹配，700 万字直接跑到超时 ——
 * 从网页扒来的小说常常几百字才一个换行，这种超长行会让 `[^\n]*$`
 * 反复回溯，慢得没有上限。indexOf 是原生扫描，一趟到底，没有回溯这回事。
 */
export function splitRawChapters(md: string, fallbackTitle: string): RawChapter[] {
  const marks: { title: string; at: number }[] = []
  const len = md.length
  let start = 0

  while (start <= len) {
    let end = md.indexOf('\n', start)
    if (end < 0) end = len
    if (end - start <= MAX_HEAD) {
      const title = headOf(md.slice(start, end))
      if (title) marks.push({ title, at: start })
    }
    if (end >= len) break
    start = end + 1
  }

  if (!marks.length) {
    return [{ title: fallbackTitle, from: 0, to: md.length }]
  }

  return marks.map((mk, i) => ({
    title: mk.title,
    from: mk.at,
    to: i + 1 < marks.length ? marks[i + 1].at : md.length,
  }))
}
