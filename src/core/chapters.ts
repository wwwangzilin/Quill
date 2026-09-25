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

/** 「第一章」「第 12 节」—— 只认开头，后面接什么都能忍（见 asChapterLine） */
const CN_HEAD = /^\s*第\s*[0-9０-９一二三四五六七八九十百千零两]+\s*[章节回卷篇話话部]/

/** Chapter 1 / CHAPTER IV */
const EN_HEAD = /^\s*chapter\s+([0-9]+|[ivxlcdm]+)\b/i

/**
 * 从网页复制来的小说，章节名后面常常直接跟着一串元信息，
 * 甚至接着正文第一句（原站是分行的，粘成 Markdown 之后成了软换行）。
 * 章节名裁到这些标记为止。
 */
const META_TAIL = /(作者|更新时间|字数|来源|本章|链接|简介|标签)\s*[:：]/

/** 把一个节点的纯文本抠出来（不含子节点的结构信息） */
function textOf(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(textOf).join('')
}

/**
 * 这一段是不是以章节标题开头？是的话返回**干净的章节名**。
 *
 * 判据刻意宽松：只看开头，不看整段。原因是从网页扒下来的小说
 * 会把「第1章 去学土木吧」和「作者：… 更新时间：… 字数：2022」
 * 乃至正文第一句塞在同一段里 —— 按「整段等于章节名」去卡，
 * 一篇也认不出来（这坑实装过一次）。
 */
function asChapterLine(raw: string): string | null {
  let line = raw.split('\n')[0].trim()
  if (!line) return null
  const cut = line.search(META_TAIL)
  if (cut > 0) line = line.slice(0, cut).trim()
  if (!CN_HEAD.test(line) && !EN_HEAD.test(line)) return null
  // 裁完之后还是太长，那多半只是正文里提到了「第三章」
  return line.length <= 40 ? line : null
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

/* ============================ 这像不像一篇小说 ============================ */

export interface NovelGuess {
  /** 结论：像不像 */
  likely: boolean
  score: number
  chars: number
  chapters: number
  /** 对白段落占的比例 */
  dialogue: number
  /** 人话依据 —— 界面上要能说清「为什么弹这个提示」 */
  reasons: string[]
}

/**
 * 判断一篇文档像不像小说。
 *
 * 阅读视图拿它决定要不要冒那句提示：不是所有长文都该按章节切 ——
 * 一篇 8000 字的读书笔记硬切章节只会更碎。所以攒几条**可解释**的证据打分：
 *
 *   章节标记 ≥ 3 个  → 3 分（最强信号：作者本来就在分章）
 *            ≥ 8 个  → 再 +1
 *   对白密度 ≥ 15%   → 2 分（小说才有大量引号对白，论文和笔记没有）
 *   篇幅     ≥ 3000  → 1 分；≥ 10000 再 +1
 *
 * 满 3 分才算。每加分都往 reasons 里留一句 —— 提示条上直接展示，
 * 用户看得见「它凭什么觉得这是小说」，而不是被一个黑盒弹窗拦住。
 */
export function guessNovel(doc: JSONContent): NovelGuess {
  const top = doc.content ?? []
  const chars = textOf(doc).replace(/\s/g, '').length
  const chapters = extractChapters(doc).length

  // 对白段落：以引号开头的那些。中文小说多用「」和“”，英文用 "
  let paras = 0
  let talks = 0
  for (const node of top) {
    if (node.type !== 'paragraph') continue
    const t = textOf(node).trim()
    if (!t) continue
    paras += 1
    if (/^[「『“"']/.test(t)) talks += 1
  }
  const dialogue = paras ? talks / paras : 0

  let score = 0
  const reasons: string[] = []
  if (chapters >= 3) {
    score += 3
    reasons.push(`认出了 ${chapters} 个章节`)
  }
  if (chapters >= 8) {
    score += 1
    reasons.push('章节很多')
  }
  if (dialogue >= 0.15) {
    score += 2
    reasons.push(`对白段落占 ${Math.round(dialogue * 100)}%`)
  }
  if (chars >= 3000) {
    score += 1
    reasons.push(`正文 ${chars} 字`)
  }
  if (chars >= 10000) {
    score += 1
    reasons.push('篇幅很长')
  }

  return { likely: score >= 3, score, chars, chapters, dialogue, reasons }
}
