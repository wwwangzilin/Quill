/**
 * 章节识别。
 *
 * 阅读视图要能「跳章」，前提是先知道章在哪。两种来源都认：
 *
 *   · **Markdown 标题**（`#` / `##` …）—— 作者自己划的结构，最可信
 *   · **「第X章」这类纯文本行** —— 从别处粘进来的小说往往一个标题标记都没有，
 *     全靠这一条才切得开。也认 Chapter 1 / CHAPTER IV 这种英文写法
 *
 * 两者混着来也没关系：Markdown 标题优先，纯文本行按 level 2 收进来，
 * 每条都标了 `inferred` 说明它是不是推出来的，界面上可以据此区分。
 */
import type { JSONContent } from '@tiptap/core'

export interface Chapter {
  /** 章节名（就是那一行的原文） */
  title: string
  /** 标题级别 1-6；纯文本认出来的一律按 2 算 */
  level: number
  /** 这一章正文的第一块在文档顶层块里的下标 —— 跳章靠它 */
  start: number
  /** 是不是从「第X章」这种纯文本推出来的 */
  inferred: boolean
}

/** 「第一章」「第 12 节」「第三回」—— 中文小说最常见的章节标记 */
const CN_CHAPTER =
  /^第\s*[0-9０-９一二三四五六七八九十百千零两]+\s*[章节回卷篇話话部]\s*[:：、.．\-—]?\s*\S*$/

/** Chapter 1 / CHAPTER IV */
const EN_CHAPTER = /^chapter\s+([0-9]+|[ivxlcdm]+)\b\s*[:：.\-—]?\s*\S*$/i

/** 把一个节点的纯文本抠出来（不含子节点的结构信息） */
function textOf(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(textOf).join('')
}

/** 这一行像不像一个章节标题？是的话返回它本身，不是返回 null */
function asChapterLine(line: string): string | null {
  const t = line.trim()
  // 太长的不像标题，多半是正文里恰好提到了「第三章」
  if (!t || t.length > 40) return null
  if (CN_CHAPTER.test(t) || EN_CHAPTER.test(t)) return t
  return null
}

/**
 * 按文档顺序抽出所有章节。
 *
 * 一个都认不出来时返回空数组 —— 调用方自己兜底成「整篇一章」，
 * 别在这里硬塞一个假章节进去。
 */
export function extractChapters(doc: JSONContent): Chapter[] {
  const out: Chapter[] = []
  const top = doc.content ?? []
  top.forEach((node, i) => {
    if (node.type === 'heading') {
      const title = textOf(node).trim()
      if (!title) return
      out.push({
        title,
        level: Number(node.attrs?.level ?? 1),
        start: i,
        inferred: false,
      })
      return
    }
    // 段落里可能是「第一章 雨夜」这种行 —— 从别处粘进来的小说全是这种
    if (node.type === 'paragraph') {
      const title = asChapterLine(textOf(node))
      if (title) out.push({ title, level: 2, start: i, inferred: true })
    }
  })
  return out
}

export interface ChapterSlice extends Chapter {
  /** 这一章包含的顶层块（含章节标题本身那一块） */
  blocks: JSONContent[]
}

/**
 * 把文档切成章。
 *
 * 认不出章节时整篇算一章，标题用传进来的文档名 ——
 * 阅读视图不该因为「这篇没写标题」就什么都读不了。
 */
export function splitChapters(doc: JSONContent, fallbackTitle: string): ChapterSlice[] {
  const top = doc.content ?? []
  const marks = extractChapters(doc)
  if (!marks.length) {
    return [{ title: fallbackTitle, level: 1, start: 0, inferred: false, blocks: top }]
  }
  return marks.map((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].start : top.length
    return { ...m, blocks: top.slice(m.start, end) }
  })
}
