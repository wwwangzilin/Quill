import { useEffect, useMemo, useRef, useState } from 'react'
import type { DocMeta } from '../core/types'
import { formatWhen } from '../core/time'

export interface PaletteCommand {
  id: string
  title: string
  hint?: string
  icon?: string
  run: () => void
}

interface Props {
  docs: DocMeta[]
  commands: PaletteCommand[]
  onPickDoc: (id: string) => void
}

type Row =
  | { kind: 'doc'; key: string; score: number; doc: DocMeta }
  | { kind: 'cmd'; key: string; score: number; cmd: PaletteCommand }

/**
 * 模糊匹配：直接包含的排前面，其次按「子序列命中」算分。
 * 中文没有大小写问题，英文顺手转小写即可。
 */
function score(text: string, query: string): number {
  if (!query) return 1
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  const idx = t.indexOf(q)
  if (idx >= 0) return 1000 - idx
  let i = 0
  let hits = 0
  for (const ch of t) {
    if (ch === q[i]) {
      i += 1
      hits += 1
      if (i === q.length) break
    }
  }
  return i === q.length ? hits : -1
}

/** Ctrl+P 呼出的命令面板：搜文档 + 执行命令，一个框全包 */
export default function CommandPalette({ docs, commands, onPickDoc }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Ctrl+P / Cmd+P 呼出（和浏览器打印冲突，所以 preventDefault 掉）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  const rows = useMemo<Row[]>(() => {
    const q = query.trim()
    const docRows: Row[] = docs
      .map((doc) => ({ kind: 'doc' as const, key: `d:${doc.id}`, score: score(doc.title, q), doc }))
      .filter((r) => r.score >= 0)
    const cmdRows: Row[] = commands
      .map((cmd) => ({
        kind: 'cmd' as const,
        key: `c:${cmd.id}`,
        score: q ? Math.max(score(cmd.title, q), score(cmd.hint ?? '', q) - 200) : 500,
        cmd,
      }))
      .filter((r) => r.score >= 0)

    const all = [...cmdRows, ...docRows]
    all.sort((a, b) => b.score - a.score)
    return all.slice(0, 40)
  }, [docs, commands, query])

  useEffect(() => {
    setIndex(0)
  }, [query])

  // 选中项滚进视野
  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [index, open])

  if (!open) return null

  const runRow = (row: Row) => {
    setOpen(false)
    if (row.kind === 'doc') onPickDoc(row.doc.id)
    else row.cmd.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      setIndex((i) => (rows.length ? (i + 1) % rows.length : 0))
      return
    }
    if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      setIndex((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[index]
      if (row) runRow(row)
    }
  }

  return (
    <div className="palette-mask" onMouseDown={() => setOpen(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-head">
          <span className="palette-icon">⌕</span>
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            placeholder="搜索文档或执行命令 · Ctrl+P"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>

        <div className="palette-list" ref={listRef}>
          {rows.length === 0 && <div className="palette-empty">没有匹配的文档或命令</div>}
          {rows.map((row, i) => (
            <button
              key={row.key}
              data-idx={i}
              className={'palette-row' + (i === index ? ' on' : '')}
              onMouseEnter={() => setIndex(i)}
              onClick={() => runRow(row)}
            >
              <span className="palette-kind">{row.kind === 'doc' ? '文' : (row.cmd.icon ?? '⌘')}</span>
              <span className="palette-title">
                {row.kind === 'doc' ? row.doc.title : row.cmd.title}
              </span>
              <span className="palette-hint">
                {row.kind === 'doc' ? formatWhen(row.doc.updatedAt) : (row.cmd.hint ?? '')}
              </span>
            </button>
          ))}
        </div>

        <div className="palette-foot">
          <span>↑↓ 选择</span>
          <span>Enter 执行</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  )
}
