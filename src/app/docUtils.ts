/**
 * 文档相关的纯函数：不碰 React、不碰存储，放这里方便单独测。
 */

import type { JSONContent, Editor } from '@tiptap/core'
import { scanMatches } from '../editor/search'
import type { Doc, DocMeta } from '../core/types'

/**
 * 在当前编辑器里跳到第 nth 个匹配处。
 *
 * 只把**光标**落过去，不选中那个词 —— 选中了的话，用户跳过来顺手一打字
 * 就把刚找到的词覆盖掉了。光标停在词首，接着写也安全。
 */
export function jumpToNth(ed: Editor, query: string, nth: number) {
  const hits = scanMatches(ed, query)
  if (!hits.length) return
  const i = Math.min(Math.max(nth, 0), hits.length - 1)
  ed.chain().focus().setTextSelection(hits[i].from).scrollIntoView().run()
}

export function toMeta(doc: Doc): DocMeta {
  return {
    id: doc.id,
    title: doc.title,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    starred: doc.starred,
  }
}

export function sortDocs(list: DocMeta[]): DocMeta[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 去空白字符数，用于统计与热力图 */
export function countChars(json: JSONContent): number {
  let n = 0
  const walk = (node: JSONContent) => {
    if (node.type === 'text') n += (node.text ?? '').replace(/\s/g, '').length
    node.content?.forEach(walk)
  }
  walk(json)
  return n
}

export function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}
