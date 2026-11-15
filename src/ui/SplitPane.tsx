import { useEffect, useMemo, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { buildExtensions } from '../editor/extensions'
import { parseDocument } from '../core/md-parse'
import { storage } from '../core/storage'
import { Icon } from './Icon'
import type { DocMeta } from '../core/types'

/**
 * 分屏的右栏：**只读**对照另一篇。
 *
 * 为什么只读：可编辑的两栏意味着两套保存链、两套冲突检测、两套撤销栈，
 * 一旦同时改同一篇就打架。v1 先把「一边看资料一边写」这件事解决 ——
 * 右栏随便翻，写还是左边那一个编辑器。
 */
interface Props {
  docs: DocMeta[]
  docId: string
  onPick: (id: string) => void
  onClose: () => void
}

export default function SplitPane({ docs, docId, onPick, onClose }: Props) {
  const [md, setMd] = useState('')
  const [title, setTitle] = useState('')

  useEffect(() => {
    let alive = true
    void (async () => {
      const raw = storage.raw ? await storage.raw(docId).catch(() => null) : null
      if (!alive) return
      if (raw == null) {
        setMd('')
        setTitle('')
        return
      }
      const parsed = parseDocument(raw)
      setMd(raw)
      setTitle(parsed.title || docs.find((d) => d.id === docId)?.title || '未命名')
    })()
    return () => {
      alive = false
    }
    // 只跟着文档 id 走：docs 数组变了不必重新读盘
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  const content = useMemo(() => (md ? parseDocument(md).doc : { type: 'doc', content: [] }), [md])

  const editor = useEditor(
    {
      extensions: buildExtensions(''),
      content,
      editable: false,
    },
    [docId, md],
  )

  return (
    <aside className="split-pane">
      <header className="split-head">
        <button className="btn ghost icon" onClick={onClose} title="关掉右侧">
          <Icon name="close" />
        </button>
        <select
          className="split-pick"
          value={docId}
          onChange={(e) => onPick(e.target.value)}
          title="选一篇来对照"
        >
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title || '未命名'}
            </option>
          ))}
        </select>
        <span className="split-badge">只读对照</span>
      </header>
      <div className="split-body" aria-label={title}>
        <EditorContent editor={editor} />
      </div>
    </aside>
  )
}
