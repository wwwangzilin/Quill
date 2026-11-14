import type { JSONContent } from '@tiptap/core'

/** 文档元信息（列表用，不含正文） */
export interface DocMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  starred: boolean
  /** 标签（文件模式下存在 .quill-meta.json，跟着 git 走） */
  tags?: string[]
  /** 正文去空白字符数 */
  chars?: number
}

/** 完整文档 */
export interface Doc extends DocMeta {
  content: JSONContent
}

export type ViewMode = 'write' | 'mindmap'

export function emptyContent(): JSONContent {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

export function newDocId(): string {
  return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export function createDoc(title = '未命名'): Doc {
  const now = Date.now()
  return {
    id: newDocId(),
    title,
    createdAt: now,
    updatedAt: now,
    starred: false,
    content: emptyContent(),
  }
}

/** 从文档正文里猜一个标题（第一行非空文本） */
export function guessTitle(content: JSONContent | undefined): string {
  const nodes = content?.content ?? []
  for (const n of nodes) {
    const text = plainText(n)
    if (text.trim()) return text.trim().slice(0, 60)
  }
  return '未命名'
}

function plainText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(plainText).join('')
}
