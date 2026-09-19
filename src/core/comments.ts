/**
 * 批注。
 *
 * **存哪**：`.quill-meta.json`（和星标 / 标签放一起），绝不写进 `.md` 正文。
 * 理由：批注是「人对这段文字的评价」，不是文章内容本身。塞进正文会污染 Markdown、
 * 让 git diff 变脏；而且发给别人时，你大概也不想让自己的评语混在正文里。
 * 它照样跟着 git 走 —— 推远程、换机器都还在。
 *
 * **定位**：存的是原文片段（quote），每次渲染时在文档里现找。所以你在上面加字、
 * 改标点、调整换行，批注都跟得住；只有把那句话本身改没了才会掉，
 * 这时列表里会把它标成「找不到原文」而不是悄悄丢掉。
 */
import type { Node as PMNode } from '@tiptap/pm/model'

export interface Comment {
  id: string
  /** 选中的原文（定位锚点） */
  quote: string
  /** 批注内容 */
  note: string
  created: number
  resolved: boolean
}

export function newCommentId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 引用最多存这么长 —— 锚点越长越脆，截一段够定位就行 */
export const MAX_QUOTE = 400

/** 把文档里所有文字拼成一串，并记下每个字符对应的 ProseMirror 位置 */
function textIndex(doc: PMNode): { text: string; pos: number[] } {
  const chars: string[] = []
  const pos: number[] = []
  doc.descendants((node, p) => {
    if (!node.isText || !node.text) return
    for (let i = 0; i < node.text.length; i += 1) {
      chars.push(node.text[i])
      pos.push(p + i)
    }
  })
  return { text: chars.join(''), pos }
}

/**
 * 在正文里找出这段引用现在的位置。
 * 先精确匹配；失败就忽略空白差异再找一次（用户往往只是改了空格和换行）。
 */
export function locate(doc: PMNode, quote: string): { from: number; to: number } | null {
  const q = quote.trim()
  if (!q) return null
  const { text, pos } = textIndex(doc)

  let at = text.indexOf(q)
  let len = q.length

  if (at < 0) {
    const kept: number[] = []
    for (let i = 0; i < text.length; i += 1) if (!/\s/.test(text[i])) kept.push(i)
    const flat = kept.map((i) => text[i]).join('')
    const flatQ = q.replace(/\s+/g, '')
    const hit = flatQ ? flat.indexOf(flatQ) : -1
    if (hit >= 0) {
      at = kept[hit]
      len = kept[hit + flatQ.length - 1] - at + 1
    }
  }
  if (at < 0 || at + len > text.length) return null

  const from = pos[at]
  const to = pos[at + len - 1]
  if (from === undefined || to === undefined) return null
  return { from, to: to + 1 }
}

/** 选区 → 存进批注的引用文本 */
export function quoteOf(doc: PMNode, from: number, to: number): string {
  return doc.textBetween(from, to, '\n', '\ufffc').trim().slice(0, MAX_QUOTE)
}

/** 时间戳 → 「刚刚 / 3 分钟前 / 昨天 14:20」 */
export function whenOf(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const d = new Date(ts)
  const today = new Date()
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (sameDay) return hm
  if (diff < 172_800_000) return `昨天 ${hm}`
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}
