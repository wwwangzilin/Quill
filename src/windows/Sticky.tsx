import { useCallback, useEffect, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { initStorage, storage } from '../core/storage'
import { closeSelf } from '../core/windows'
import { toast } from '../ui/toast'
import ToastHost from '../ui/ToastHost'

/** 把编辑器 JSON 摊成好读的纯文本（磁贴是给人扫一眼和复制的） */
function toPlainText(node: JSONContent | undefined, depth = 0): string {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  const pad = '  '.repeat(depth)
  const kids = (d: number) => (node.content ?? []).map((c) => toPlainText(c, d)).join('')

  switch (node.type) {
    case 'doc':
      return kids(0)
    case 'paragraph':
      return pad + kids(depth) + '\n'
    case 'heading':
      return pad + kids(depth) + '\n'
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return (node.content ?? []).map((li) => toPlainText(li, depth)).join('')
    case 'listItem':
    case 'taskItem': {
      const mark = node.type === 'taskItem' ? (node.attrs?.checked ? '☑ ' : '☐ ') : '· '
      const inner = node.content ?? []
      const head = inner[0] ? toPlainText(inner[0], 0).trimEnd() : ''
      const rest = inner.slice(1).map((c) => toPlainText(c, depth + 1)).join('')
      return pad + mark + head + '\n' + rest
    }
    case 'blockquote':
      return kids(depth + 1)
    case 'codeBlock':
      return (node.content ?? []).map((c) => c.text ?? '').join('') + '\n'
    case 'horizontalRule':
      return '────────\n'
    case 'image':
      return `[图片] ${String(node.attrs?.src ?? '')}\n`
    case 'video':
      return `[视频] ${String(node.attrs?.src ?? '')}\n`
    default:
      return kids(depth)
  }
}

interface Props {
  doc: string
}

/** 桌面磁贴：把一篇文档钉在屏幕上，随时查、随时复制 */
export default function Sticky({ doc }: Props) {
  const [title, setTitle] = useState(doc.replace(/\.md$/, ''))
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      await initStorage()
      const d = await storage.get(doc)
      if (d) {
        setTitle(d.title)
        setText(toPlainText(d.content).trimEnd())
      }
      setLoaded(true)
    } catch {
      setLoaded(true)
    }
  }, [doc])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="sticky-root">
      <div className="sticky-bar" data-tauri-drag-region>
        <span className="sticky-title">{title}</span>
        <span className="grow" />
        <button
          className="sticky-btn"
          title="复制全文"
          onClick={() => {
            void navigator.clipboard.writeText(text)
            toast.success('已复制全文')
          }}
        >
          ⧉
        </button>
        <button className="sticky-btn" title="重新读取" onClick={() => void load()}>
          ↻
        </button>
        <button className="sticky-btn" title="取消磁贴" onClick={() => void closeSelf()}>
          ×
        </button>
      </div>

      <div className="sticky-body">
        {!loaded ? (
          <div className="sticky-empty">读取中…</div>
        ) : text ? (
          <pre className="sticky-text">{text}</pre>
        ) : (
          <div className="sticky-empty">这篇文档还是空的</div>
        )}
      </div>

      <ToastHost />
    </div>
  )
}
