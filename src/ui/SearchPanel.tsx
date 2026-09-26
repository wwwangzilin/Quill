import { useEffect, useRef, useState } from 'react'
import { searchVault, type DocSearchHit, type DocSearchResult } from '../core/searchDocs'

interface Props {
  /** 跳到某篇文档的某一次命中 */
  onPick: (hit: DocSearchHit, query: string) => void
}

/** 片段里的关键词描出来 */
function Mark({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="hit-mark">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

/**
 * Ctrl+Shift+F 呼出的全文搜索 —— 搜的是**所有文档的正文**。
 *
 * 和命令面板（Ctrl+P，只搜标题）分工明确：那个用来"打开某一篇"，
 * 这个用来"找回某一句"。
 */
export default function SearchPanel({ onPick }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<DocSearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Ctrl+Shift+F 呼出。Ctrl+F 是「当前文档内查找」，让给它。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
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
    setResult(null)
    setIndex(0)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  // 输入就搜，但防抖 160ms。
  // alive 是必须的：打字快的时候请求会乱序回来，
  // 迟到的旧结果不能盖掉新的（表现会是「结果和输入框对不上」）。
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setResult(null)
      setBusy(false)
      return
    }
    let alive = true
    setBusy(true)
    const timer = window.setTimeout(() => {
      void searchVault(q).then((r) => {
        if (!alive) return
        setResult(r)
        setBusy(false)
      })
    }, 160)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [query, open])

  const hits = result?.hits ?? []

  useEffect(() => {
    setIndex(0)
  }, [query, result])

  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [index, open])

  if (!open) return null

  const pick = (hit: DocSearchHit) => {
    setOpen(false)
    onPick(hit, query.trim())
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => (hits.length ? (i + 1) % hits.length : 0))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => (hits.length ? (i - 1 + hits.length) % hits.length : 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const hit = hits[index]
      if (hit) pick(hit)
    }
  }

  const q = query.trim()
  const count = result ? `在 ${result.files} 篇里找到 ${result.total} 处` : ''

  return (
    <div className="palette-mask" onMouseDown={() => setOpen(false)}>
      <div className="palette search-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-head">
          <span className="palette-icon">⌕</span>
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            placeholder="在所有文档的正文里找 · Ctrl+Shift+F"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {busy && <span className="hit-busy">搜索中</span>}
        </div>

        <div className="palette-list" ref={listRef}>
          {!q && <div className="palette-empty">输入关键词，检索全部文档的正文</div>}
          {q && !busy && hits.length === 0 && (
            <div className="palette-empty">没有文档包含「{q}」</div>
          )}
          {hits.map((hit, i) => {
            const first = i === 0 || hits[i - 1].file !== hit.file
            return (
              <button
                key={`${hit.file}:${hit.nth}`}
                data-idx={i}
                className={'hit-row' + (i === index ? ' on' : '') + (first ? ' first' : '')}
                onMouseEnter={() => setIndex(i)}
                onClick={() => pick(hit)}
              >
                <span className="hit-file">{first ? hit.title : ''}</span>
                <span className="hit-text">
                  <Mark text={hit.snippet} q={q} />
                </span>
                <span className="hit-line">{hit.line}</span>
              </button>
            )
          })}
        </div>

        <div className="palette-foot">
          <span>{count}</span>
          {result?.truncated && <span className="hit-warn">只列了前 {hits.length} 处</span>}
          <span className="foot-gap" />
          <span>↑↓ 选择</span>
          <span>Enter 跳转</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  )
}
