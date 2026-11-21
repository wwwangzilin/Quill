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

/**
 * 「## 一、开场段落」这种 Markdown 标题返回级别；不是标题返回 0。
 *
 * 为什么要单独认它：编号列表 `1. xxx` 和「1.标题」这种小说分节在文本上
 * 长得一模一样。一篇正经用 `#` 分章的 Markdown，正文里的有序列表会被
 * 以前那套 NUM_HEAD 规则当成章节 —— 一百多个列表项就切出一百多章。
 * 只要文档里有**至少两个同级标题**，就按标题分章，别再猜编号。
 */
function headingLevel(line: string): number {
  let i = 0
  while (i < line.length && line[i] === '#') i += 1
  if (i === 0 || i > 6) return 0
  const rest = line.slice(i)
  // CommonMark：井号后面要么空白、要么行尾，`#标签` 不算标题
  if (rest && rest[0] !== ' ' && rest[0] !== '\t') return 0
  return i
}

/** 标题行去掉井号和尾部元信息，留下的就是章名 */
function headingTitle(line: string): string {
  const bare = line.replace(/^#{1,6}\s+/, '').trim()
  const cut = bare.search(META_TAIL)
  return (cut > 0 ? bare.slice(0, cut) : bare).trim().slice(0, MAX_HEAD)
}

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
  /** 标题章：at 是**标题之后**那一行的起点（标题本身当章名，不进正文） */
  const heads: { level: number; title: string; at: number }[] = []
  /** 老规则认出来的章（「第X章」「1.标题」…），只在没有 Markdown 标题时用 */
  const marks: { title: string; at: number }[] = []
  const len = md.length
  let start = 0

  while (start <= len) {
    let end = md.indexOf('\n', start)
    if (end < 0) end = len
    if (end - start <= MAX_HEAD) {
      const line = md.slice(start, end)
      const level = headingLevel(line)
      if (level) {
        heads.push({ level, title: headingTitle(line), at: end < len ? end + 1 : end })
      } else {
        const title = headOf(line)
        if (title) marks.push({ title, at: start })
      }
    }
    if (end >= len) break
    start = end + 1
  }

  /*
   * 有 Markdown 标题就只按标题分：取**出现次数 ≥ 2 的最浅一级**。
   * 这样「# 书名 / ## 第一章 / ### 小节」取的是 `##`，
   * 而不是把书名也切成一章、也不把小节切得过碎。
   */
  const counts = new Array<number>(7).fill(0)
  for (const h of heads) counts[h.level] += 1
  let useLevel = 0
  for (let l = 1; l <= 3; l += 1) {
    if (counts[l] >= 2) {
      useLevel = l
      break
    }
  }

  const picked =
    useLevel > 0
      ? heads.filter((h) => h.level === useLevel).map((h) => ({ title: h.title, at: h.at }))
      : marks

  if (!picked.length) {
    return [{ title: fallbackTitle, from: 0, to: md.length }]
  }

  return picked.map((mk, i) => ({
    title: mk.title || `片段 ${i + 1}`,
    from: mk.at,
    to: i + 1 < picked.length ? picked[i + 1].at : md.length,
  }))
}
