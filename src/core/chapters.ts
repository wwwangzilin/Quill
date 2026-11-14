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
  /** 这一章正文的第一块在文档顶层块里的下标 */
  start: number
  /**
   * 标题在那一块里的第几行（0 基）。
   *
   * 从网页扒下来的小说，章与章之间常常**没有空行** —— 上一章的结尾、
   * 「第N章 xxx」、作者信息会挤在同一个段落里（靠软换行分隔）。
   * 所以切章时得知道「从这块的第几行开始才算这一章」，
   * 否则每一章开头都会带着上一章的尾巴。
   */
  line: number
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
 * 这一行里有没有章节标题？有的话返回**干净的章节名**。
 *
 * 判据刻意宽松，因为从网页扒下来的小说排版很脏：
 *
 *   · 章名后面直接跟着「作者：… 更新时间：… 字数：…」，甚至接着正文第一句
 *   · 有些站把一句推荐语用【】挂在章名前面
 *   · 章与章之间没有空行时，上一章的结尾会和「第N章」挤在同一行
 *
 * 最后一种靠一个很硬的旁证认：**章名后面紧跟着元信息**。
 * 正文里顺口提一句「第三章」是不会跟着「作者：」的。
 */
function asChapterLine(raw: string): string | null {
  let line = raw.trim()
  if (!line) return null
  // 有些站会把一句推荐语用【】挂在章名前面
  line = line.replace(/^【[^】]{0,40}】\s*/, '')

  // 先把跟在章名后面的元信息裁掉
  const cut = line.search(META_TAIL)
  let head = cut > 0 ? line.slice(0, cut).trim() : line

  // 章名被夹在正文里（上一章的结尾和它同一行）—— 从里面把它抠出来
  if (cut > 0 && !CN_HEAD.test(head) && !EN_HEAD.test(head)) {
    const m = head.match(/\s(第\s*[0-9０-９一二三四五六七八九十百千零两]+\s*[章节回卷篇話话部])\s*\S{0,28}$/)
    if (m) head = m[0].trim()
  }

  if (!CN_HEAD.test(head) && !EN_HEAD.test(head)) return null
  return head.length <= 40 ? head : null
}

/**
 * 按文档顺序抽出所有章节。
 *
 * **必须逐行看，不能只看段首**：从网页扒下来的小说里，章与章之间往往没有空行，
 * 于是「上一章结尾 \n 第N章 xxx \n 作者：…」全在同一个段落里
 * （靠软换行分隔）。只看段首的话，一篇 22 章的小说他只认得出第 1 章
 * —— 这坑实装机上踩过一次。
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
        line: 0,
        inferred: false,
      })
      return
    }
    if (node.type !== 'paragraph') return
    textOf(node)
      .split('\n')
      .forEach((line, k) => {
        const title = asChapterLine(line)
        if (title) out.push({ title, level: 2, start: i, line: k, inferred: true })
      })
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
    return [
      { title: fallbackTitle, level: 1, start: 0, line: 0, inferred: false, blocks: top },
    ]
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
