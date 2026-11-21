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

/** 数字：阿拉伯、全角、小写、大写（壹贰叁…）、〇 */
const NUM = '[0-9０-９一二三四五六七八九十百千万零〇两壹贰叁肆伍陆柒捌玖拾佰仟]'

/** 「第一章」「第 12 节」「第三幕」—— 只认开头，后面接什么都能忍（见 asChapterLine） */
const CN_HEAD = new RegExp(`^\\s*第\\s*${NUM}+\\s*[章节回卷篇話话部幕集季]`)

/** Chapter 1 / CHAPTER IV / Chapter Twelve / Part 2 */
const EN_NUM_WORDS =
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[- ]\\w+)?|thirty|forty|fifty'
const EN_HEAD = new RegExp(
  `^\\s*(?:chapter\\s+([0-9]+|[ivxlcdm]+|${EN_NUM_WORDS})|(?:part|book)\\s+([0-9]+|${EN_NUM_WORDS}))\\b`,
  'i',
)

/** 不带「第X章」的特殊章名：序章、楔子、番外、尾声……后面可以跟一个短标题 */
const SPECIAL_CN =
  /^\s*(序章|序言|序幕|序|楔子|引子|前言|自序|后记|后序|尾声|终章|最终章|完结感言|完本感言|番外(?:篇|章)?|附录|结语|间章|外传|大结局|卷[一二三四五六七八九十百0-9]+)(?:$|[\s:：·\-—_.、（(【])/
const SPECIAL_EN = /^\s*(prologue|epilogue|preface|afterword|interlude|foreword)\b/i

/** 句末标点：带着它的多半是正文里的一句话，不是标题 */
const SENTENCE_END = /[。！？!?；;，,]$/

/** 去掉标题外面套的括号：【第一章】 《第一章》 [第1章] */
const WRAP_OPEN = /^[\[【《（(〈「『]\s*/

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
  // 但【第一章 开端】这种整个章名被括起来的不能当推荐语吃掉
  const lead = /^【([^】]{0,40})】\s*/.exec(line)
  if (lead && !CN_HEAD.test(lead[1]) && !EN_HEAD.test(lead[1]) && !SPECIAL_CN.test(lead[1])) {
    line = line.slice(lead[0].length)
  }

  line = line.replace(WRAP_OPEN, '')

  // 先把跟在章名后面的元信息裁掉
  const cut = line.search(META_TAIL)
  let head = cut > 0 ? line.slice(0, cut).trim() : line

  // 章名被夹在正文里（上一章的结尾和它同一行）—— 从里面把它抠出来
  if (cut > 0 && !CN_HEAD.test(head) && !EN_HEAD.test(head)) {
    const m = head.match(new RegExp(`\\s(第\\s*${NUM}+\\s*[章节回卷篇話话部幕集季])\\s*\\S{0,28}$`))
    if (m) head = m[0].trim()
  }

  // 收尾的括号也去掉：【第一章 开端】
  head = head.replace(/\s*[\]】》）)〉」』]$/, '')

  if (CN_HEAD.test(head) || EN_HEAD.test(head)) return head.length <= 40 ? head : null
  // 序章 / 番外 / Prologue 这类：必须短、不能像一句话，免得把正文里的「序」误当标题
  if ((SPECIAL_CN.test(head) || SPECIAL_EN.test(head)) && head.length <= 28 && !SENTENCE_END.test(head)) {
    return head
  }
  return null
}

/**
 * 按文档顺序抽出所有章节。
 *
 * **必须逐行看，不能只看段首**：从网页扒下来的小说里，章与章之间往往没有空行，
 * 于是「上一章结尾 \n 第N章 xxx \n 作者：…」全在同一个段落里
 * （靠软换行分隔）。只看段首的话，一篇 22 章的小说他只认得出第 1 章
 * —— 这坑实装机上踩过一次。
 */
/** 「1、开端」「12. 回乡」这种只有数字序号的标题 */
const NUMBERED = /^\s*(\d{1,4})\s*[、.．:：]\s*(\S.{0,30})$/

/**
 * 兜底：整篇找不到「第X章」时，看有没有一串**连续递增**的数字小标题。
 *
 * 单看一行「3. 买牛奶」分不出是章名还是清单，所以必须成串：
 * 至少 3 个、每个比前一个大 1，才当成章节。清单很少会写得这么整齐还不带句末标点。
 */
function numberedChapters(top: JSONContent[]): Chapter[] {
  const cand: { n: number; title: string; i: number; k: number }[] = []
  top.forEach((node, i) => {
    if (node.type !== 'paragraph') return
    textOf(node)
      .split('\n')
      .forEach((line, k) => {
        const m = NUMBERED.exec(line)
        if (m && !SENTENCE_END.test(line.trim())) {
          cand.push({ n: Number(m[1]), title: line.trim(), i, k })
        }
      })
  })
  // 找最长的 +1 递增串
  let best: typeof cand = []
  let run: typeof cand = []
  for (const c of cand) {
    if (run.length && c.n === run[run.length - 1].n + 1) run.push(c)
    else run = [c]
    if (run.length > best.length) best = [...run]
  }
  if (best.length < 3) return []
  return best.map((c) => ({ title: c.title, level: 2, start: c.i, line: c.k, inferred: true }))
}

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
  if (out.length < 2) {
    const numbered = numberedChapters(top)
    if (numbered.length) return numbered
  }
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
