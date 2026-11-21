import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { refreshSearch, replaceAll, replacementFor, scanMatches } from '../editor/search'
import { FIND_DEFAULTS, isValidQuery, type FindOpts } from '../core/findMatch'
import { useSetting } from '../core/settings'
import { toast } from './toast'

interface Props {
  open: boolean
  editor: Editor | null
  onClose: () => void
}

export default function FindBar({ open, editor, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [active, setActive] = useState(0)
  const [count, setCount] = useState(0)
  /** 区分大小写 / 全词 / 正则，记住上次的选择 */
  const [opts, setOpts] = useSetting<FindOpts>('findOpts', FIND_DEFAULTS)
  const valid = isValidQuery(query, opts)
  const inputRef = useRef<HTMLInputElement>(null)

  // 每次查询/游标变化都刷新高亮与计数
  useEffect(() => {
    if (!editor) return
    if (!open) {
      refreshSearch(editor, '', 0, opts)
      return
    }
    const hits = scanMatches(editor, query, opts)
    setCount(hits.length)
    const idx = hits.length ? Math.min(active, hits.length - 1) : 0
    refreshSearch(editor, query, idx, opts)
    if (idx !== active) setActive(idx)
  }, [editor, query, active, open, opts])

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 30)
    } else {
      setQuery('')
      setReplacement('')
      setActive(0)
      setCount(0)
    }
  }, [open])

  const jump = useCallback(
    (delta: number) => {
      if (!editor || !count) return
      const next = (active + delta + count) % count
      setActive(next)
      const hits = scanMatches(editor, query, opts)
      const hit = hits[next]
      if (!hit) return
      editor.chain().focus().setTextSelection(hit).run()
      try {
        const coords = editor.view.coordsAtPos(hit.from)
        window.scrollBy({ top: coords.top - window.innerHeight * 0.35, behavior: 'smooth' })
      } catch {
        /* 定位失败就算了 */
      }
    },
    [editor, active, count, query, opts],
  )

  const replaceOne = useCallback(() => {
    if (!editor || !count) return
    const hits = scanMatches(editor, query, opts)
    const hit = hits[active]
    if (!hit) return
    // insertText 而不是 insertContentAt：后者会把 < & 当标记解析，替换串里写了会出怪事
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.insertText(replacementFor(hit, query, replacement, opts), hit.from, hit.to)
        return true
      })
      .run()
    setActive((a) => Math.max(0, a))
  }, [editor, active, count, query, replacement, opts])

  const replaceEvery = useCallback(() => {
    if (!editor || !query) return
    const n = replaceAll(editor, query, replacement, opts)
    toast.success(n ? `已替换 ${n} 处` : '没有匹配项')
  }, [editor, query, replacement, opts])

  if (!open) return null

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        className={'find-input' + (valid ? '' : ' invalid')}
        value={query}
        placeholder="查找…"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            jump(e.shiftKey ? -1 : 1)
          }
        }}
      />
      {(
        [
          ['caseSensitive', 'Aa', '区分大小写'],
          ['wholeWord', 'ab', '全词匹配'],
          ['regex', '.*', '正则表达式（替换里可用 $1）'],
        ] as const
      ).map(([k, label, tip]) => (
        <button
          key={k}
          type="button"
          className={'find-opt' + (opts[k] ? ' on' : '')}
          title={tip}
          aria-pressed={opts[k]}
          onClick={() => {
            setOpts({ ...opts, [k]: !opts[k] })
            setActive(0)
          }}
        >
          {label}
        </button>
      ))}
      <span className="find-count">
        {!valid ? '正则有误' : query ? `${count ? active + 1 : 0}/${count}` : '—'}
      </span>
      <button className="btn ghost icon" onClick={() => jump(-1)} title="上一个 · Shift+Enter">
        ↑
      </button>
      <button className="btn ghost icon" onClick={() => jump(1)} title="下一个 · Enter">
        ↓
      </button>
      <input
        className="find-input"
        value={replacement}
        placeholder="替换为…"
        spellCheck={false}
        onChange={(e) => setReplacement(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            replaceOne()
          }
        }}
      />
      <button className="btn" onClick={replaceOne} disabled={!count}>
        替换
      </button>
      <button className="btn" onClick={replaceEvery} disabled={!count}>
        全部
      </button>
      <button className="btn ghost icon" onClick={onClose} title="关闭 · Esc">
        ×
      </button>
    </div>
  )
}
