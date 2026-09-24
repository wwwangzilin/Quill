import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { initStorage, storage } from '../core/storage'
import { closeSelf, markWindowReady } from '../core/windows'
import { toast } from '../ui/toast'
import ToastHost from '../ui/ToastHost'

function plain(node: JSONContent | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(plain).join('')
}

/** 从收件箱里取出最后几条，最新的放最上面 */
function recentFrom(content: JSONContent, limit = 6): string[] {
  const out: string[] = []
  for (const node of content.content ?? []) {
    if (node.type !== 'bulletList') continue
    for (const li of node.content ?? []) {
      const t = plain(li).trim()
      if (t) out.push(t)
    }
  }
  return out.slice(-limit).reverse()
}

/** 快捷便签窗口：Ctrl+Space 唤起，回车就存 */
export default function QuickNote() {
  const [text, setText] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const ref = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    try {
      await initStorage()
      const list = await storage.list()
      const inbox = list.find((d) => d.title === '收件箱')
      if (!inbox) {
        setRecent([])
        return
      }
      const doc = await storage.get(inbox.id)
      if (doc) setRecent(recentFrom(doc.content))
    } catch {
      /* 读不到就空着 */
    }
  }, [])

  useEffect(() => {
    void load()
    void markWindowReady()
    const timer = window.setTimeout(() => ref.current?.focus(), 80)
    return () => window.clearTimeout(timer)
  }, [load])

  const save = useCallback(async () => {
    const value = text.trim()
    if (!value) return
    try {
      const list = await storage.list()
      let target = list.find((d) => d.title === '收件箱')
      if (!target) {
        const fresh = await storage.create('收件箱')
        const saved = await storage.put(fresh)
        target = { ...fresh, id: saved.id }
      }
      const doc = await storage.get(target.id)
      if (!doc) throw new Error('收件箱读取失败')
      const stamp = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      const item: JSONContent = {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: `${stamp}  ${value}` }] }],
          },
        ],
      }
      await storage.put({
        ...doc,
        content: { type: 'doc', content: [...(doc.content.content ?? []), item] },
        updatedAt: Date.now(),
      })
      setText('')
      toast.success('已记一笔')
      await load()
    } catch (err) {
      toast.error('保存失败', String(err))
    }
  }, [text, load])

  return (
    <div className="qn-root">
      <div className="qn-bar" data-tauri-drag-region>
        <span className="qn-title">快捷便签</span>
        <span className="grow" />
        <button className="qn-x" onClick={() => void closeSelf()} title="关闭 · Esc">
          ×
        </button>
      </div>

      <textarea
        ref={ref}
        className="qn-input"
        value={text}
        placeholder="想到什么就写下来…"
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            void closeSelf()
            return
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void save()
          }
        }}
      />

      <div className="qn-foot">
        <span className="qn-hint">回车存 · Shift+回车换行 · Esc 关</span>
        <button className="btn primary" onClick={() => void save()}>
          存进收件箱
        </button>
      </div>

      {recent.length > 0 && (
        <div className="qn-recent">
          <div className="qn-recent-title">最近</div>
          {recent.map((t, i) => (
            <div
              className="qn-item"
              key={i}
              title="点击复制"
              onClick={() => {
                void navigator.clipboard.writeText(t.replace(/^\d{1,2}:\d{2}\s+/, ''))
                toast.success('已复制')
              }}
            >
              {t}
            </div>
          ))}
        </div>
      )}

      <ToastHost />
    </div>
  )
}
