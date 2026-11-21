import { useEffect, useMemo, useRef, useState } from 'react'
import { Glyph } from './Icon'
import type { DocMeta } from '../core/types'
import { formatWhen } from '../core/time'
import { searchVault, type DocSearchHit } from '../core/searchDocs'
import { hintOf } from '../core/shortcuts'

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
  /** 最近用过的文档（App 侧按 MRU 维护），空查询时排在最前 */
  recent?: string[]
  /** 点中正文命中：把落点交给 App（它知道怎么在编辑器里定位） */
  onPickHit?: (hit: DocSearchHit, query: string) => void
}

type Row =
  | { kind: 'recent'; key: string; doc: DocMeta }
  | { kind: 'doc'; key: string; score: number; doc: DocMeta }
  | { kind: 'body'; key: string; score: number; hit: DocSearchHit }
  | { kind: 'cmd'; key: string; score: number; cmd: PaletteCommand }

const GROUP_TITLE: Record<Row['kind'], string> = {
  recent: '最近打开',
  doc: '文档',
  body: '正文匹配',
  cmd: '命令',
}

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

/** 命中片段里把关键词标出来（转义后按第一次出现切三刀） */
function highlight(text: string, query: string) {
  const q = query.trim()
  if (!q) return text
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

/**
 * Ctrl+P：**一个框搜全部**。
 *
 * 以前这里只按标题匹配，侧栏搜索却能搜正文 —— 同一个词两个入口给两种结果。
 * 现在：
 *   · 空查询 = 最近打开的文档 + 常用命令
 *   · 输入后 = 标题/标签（本地，即时） + 正文（Rust 全文搜索，防抖 180ms） + 命令
 *   · 正文结果带片段预览，点一条直接落到那一处
 */
export default function CommandPalette({ docs, commands, onPickDoc, recent = [], onPickHit }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [hits, setHits] = useState<DocSearchHit[]>([])
  const [searching, setSearching] = useState(false)
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
    setHits([])
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  /*
   * 正文搜索：防抖 + 只打一次仓储。
   *
   * 为什么不在每次按键都扫：几百篇文档全文扫一遍是毫秒级，但**每次都扫**就变成
   * 输入卡顿的来源。180ms 的停顿足够把「连打」合并成一次。
   */
  useEffect(() => {
    const q = query.trim()
    if (!open || q.length < 2) {
      setHits([])
      setSearching(false)
      return
    }
    let alive = true
    setSearching(true)
    const timer = window.setTimeout(() => {
      void searchVault(q, 60).then((res) => {
        if (!alive) return
        setHits(res.hits.slice(0, 12))
        setSearching(false)
      })
    }, 180)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [query, open])

  const rows = useMemo<Row[]>(() => {
    const q = query.trim()

    if (!q) {
      const recentRows: Row[] = recent
        .map((id) => docs.find((d) => d.id === id))
        .filter((d): d is DocMeta => Boolean(d))
        .slice(0, 5)
        .map((doc) => ({ kind: 'recent' as const, key: `r:${doc.id}`, doc }))
      const cmdRows: Row[] = commands.map((cmd) => ({
        kind: 'cmd' as const,
        key: `c:${cmd.id}`,
        score: 500,
        cmd,
      }))
      return [...recentRows, ...cmdRows]
    }

    const docRows: Array<Extract<Row, { kind: 'doc' }>> = docs
      .map((doc) => ({
        kind: 'doc' as const,
        key: `d:${doc.id}`,
        // 标题命中优先，其次标签
        score: Math.max(score(doc.title, q), score((doc.tags ?? []).join(' '), q) - 300),
        doc,
      }))
      .filter((r) => r.score >= 0)

    const bodyRows: Row[] = hits.map((hit, i) => ({
      kind: 'body' as const,
      key: `b:${hit.file}:${hit.nth}`,
      // 正文整体排在标题命中之后，但保留后端给的顺序
      score: 300 - i,
      hit,
    }))

    const cmdRows: Array<Extract<Row, { kind: 'cmd' }>> = commands
      .map((cmd) => ({
        kind: 'cmd' as const,
        key: `c:${cmd.id}`,
        score: Math.max(score(cmd.title, q), score(cmd.hint ?? '', q) - 200),
        cmd,
      }))
      .filter((r) => r.score >= 0)

    // 分组顺序就是优先级：文档标题 → 正文 → 命令
    const byScore = <T extends { score: number }>(a: T, b: T) => b.score - a.score
    return [...docRows.sort(byScore), ...bodyRows, ...cmdRows.sort(byScore)]
  }, [docs, commands, query, hits, recent])

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
    if (row.kind === 'doc' || row.kind === 'recent') onPickDoc(row.doc.id)
    else if (row.kind === 'body') {
      if (onPickHit) onPickHit(row.hit, query.trim())
      else onPickDoc(row.hit.file)
    } else row.cmd.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      setIndex((i) => Math.min(rows.length - 1, i + 1))
      return
    }
    if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      setIndex((i) => Math.max(0, i - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[index]
      if (row) runRow(row)
    }
  }

  let lastKind: Row['kind'] | null = null

  return (
    <div className="palette-mask" onMouseDown={() => setOpen(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-head">
          <span className="palette-icon">
            <Glyph g="⌕" />
          </span>
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            placeholder="搜索文档、正文或执行命令…"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="palette-kbd">{hintOf('palette')}</span>
        </div>

        <div className="palette-list" ref={listRef}>
          {rows.length === 0 && (
            <div className="palette-empty">
              {searching ? '正在搜索正文…' : `没有匹配「${query}」的文档或命令`}
            </div>
          )}
          {rows.map((row, i) => {
            const header = row.kind !== lastKind ? GROUP_TITLE[row.kind] : null
            lastKind = row.kind
            const active = i === index
            return (
              <div key={row.key}>
                {header && <div className="palette-group">{header}</div>}
                <div
                  className={'palette-row' + (active ? ' on' : '')}
                  data-idx={i}
                  onMouseEnter={() => setIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    runRow(row)
                  }}
                >
                  <span className="palette-kind">
                    <Glyph
                      g={
                        row.kind === 'cmd'
                          ? (row.cmd.icon ?? '⌘')
                          : row.kind === 'body'
                            ? '📄'
                            : '▤'
                      }
                    />
                  </span>
                  <span className="palette-title">
                    {row.kind === 'doc' || row.kind === 'recent'
                      ? highlight(row.doc.title || '未命名', query)
                      : row.kind === 'body'
                        ? highlight(row.hit.title || row.hit.file, query)
                        : row.cmd.title}
                    {row.kind === 'body' && (
                      <span className="palette-snippet">
                        {highlight(row.hit.snippet, query)}
                      </span>
                    )}
                    {row.kind === 'recent' && (
                      <span className="palette-snippet">上次编辑 {formatWhen(row.doc.updatedAt)}</span>
                    )}
                  </span>
                  <span className="palette-hint">
                    {row.kind === 'cmd'
                      ? row.cmd.hint
                      : row.kind === 'body'
                        ? `第 ${row.hit.line} 行`
                        : formatWhen(row.doc.updatedAt)}
                  </span>
                </div>
              </div>
            )
          })}
          {searching && rows.length > 0 && <div className="palette-empty">正在搜索正文…</div>}
        </div>
        <div className="palette-foot">
          <span>↑↓ 选择</span>
          <span>Enter 打开</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  )
}
