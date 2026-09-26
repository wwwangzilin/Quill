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
/**
 * 「1.标题」「2、标题」—— 扒下来的小说大量用这种编号分节。
 *
 * 实测某篇 7.4MB 的小说：「第X章」只有 20 个，而「1.…」「2.…」有 **1047** 个。
 * 不认这种写法，目录里就剩几个「第X卷」，看着像章节整个丢了。
 *
 * 约束要紧，因为正文里也有数字开头的句子：
 * · 1~4 位数字，而且分隔符**不含中文逗号** ——
 *   「2012，2032，两者之间间隔了二十年之久。」这种年份并列就是这么挡掉的；
 * · 分隔符后面必须是「非空白、非数字」，免得把「1.5 倍」当成一节。
 */
const NUM_HEAD = /^[0-9]{1,4}\s*[.．、]\s*(?=[^\s0-9])/
/**
 * 没有数字的固定标题词 —— 「第X章」那套认不到它们。
 * 别往里加单字（「序」「幕」），正文里太容易撞上。
 */
const EXTRA_HEADS = ['楔子', '序章', '终章', '尾声', '后记', '番外', '间幕', '幕间', '外传', '作者的话']
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
  const isExtra = EXTRA_HEADS.some((w) => bare.startsWith(w))
  if (!CN_HEAD.test(bare) && !EN_HEAD.test(bare) && !NUM_HEAD.test(bare) && !isExtra) return null
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
