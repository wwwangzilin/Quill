import { useEffect, useMemo, useRef, useState } from 'react'
import { mergeHits } from '../core/bookSearch'
import Icon from './Icon'

/**
 * 阅读器里的全书搜索：输入关键词，按章列出所有命中，点一条跳过去。
 *
 * 各章文字按需取（超大文档要分章读盘 + 解析），取过的缓存着，换个词再搜是瞬间的。
 * 第一次搜会把全书扫一遍，期间一章一章往下补结果，不卡界面。
 */
export default function BookSearch({
  open,
  onClose,
  docId,
  titles,
  loadText,
  onGo,
}: {
  open: boolean
  onClose: () => void
  docId: string
  titles: string[]
  /** 取第 ci 章的拍平文字（和页面渲染同一套下标） */
  loadText: (ci: number) => Promise<string>
  onGo: (ci: number, from: number, to: number, query: string) => void
}) {
  const [q, setQ] = useState('')
  const [texts, setTexts] = useState<(string | undefined)[]>([])
  const [scanning, setScanning] = useState(false)
  const cache = useRef(new Map<number, string>())
  const inputRef = useRef<HTMLInputElement>(null)
  const query = q.trim()

  // 换书 / 章节表变了：缓存作废
  useEffect(() => {
    cache.current.clear()
    setTexts([])
  }, [docId, titles.length])

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.select(), 30)
  }, [open])

  // 有关键词时把还没取的章补齐；关键词变了不用重取，缓存里的直接用
  useEffect(() => {
    if (!open || !query) return
    let alive = true
    const run = async () => {
      setScanning(true)
      for (let ci = 0; ci < titles.length && alive; ci += 1) {
        if (cache.current.has(ci)) continue
        let t = ''
        try {
          t = await loadText(ci)
        } catch {
          t = ''
        }
        if (!alive) return
        cache.current.set(ci, t)
        // 每 8 章刷一次界面；再让出一帧，别把主线程占死
        if (ci % 8 === 7) {
          setTexts(titles.map((_, i) => cache.current.get(i)))
          await new Promise((r) => setTimeout(r, 0))
        }
      }
      if (alive) {
        setTexts(titles.map((_, i) => cache.current.get(i)))
        setScanning(false)
      }
    }
    void run()
    return () => {
      alive = false
      setScanning(false)
    }
  }, [open, query, titles, loadText])

  const result = useMemo(() => mergeHits(titles, texts, query, 300), [titles, texts, query])
  if (!open) return null

  return (
    <div className="book-search" role="dialog" aria-label="全书搜索">
      <div className="book-search-head">
        <Icon name="search" />
        <input
          ref={inputRef}
          value={q}
          placeholder="在整本书里搜…"
          onChange={(e) => setQ(e.target.value)}
          spellCheck={false}
        />
        <button className="btn ghost mini" onClick={onClose}>
          关闭
        </button>
      </div>
      <div className="book-search-body">
        {!query && <div className="book-search-tip">输入关键词，按章列出所有出现的地方。</div>}
        {query && !result.total && !scanning && <div className="book-search-tip">没找到「{query}」。</div>}
        {result.groups.map((g) => (
          <div key={g.ci} className="book-search-group">
            <div className="book-search-chapter">
              {g.title}
              <em>{g.hits.length}</em>
            </div>
            {g.hits.map((h) => (
              <button key={h.from} className="book-search-hit" onClick={() => onGo(g.ci, h.from, h.to, query)}>
                <span>{h.pre}</span>
                <mark>{h.mid}</mark>
                <span>{h.post}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      {query && (
        <div className="book-search-foot">
          {scanning ? `正在扫全书… 已找到 ${result.total} 处` : `共 ${result.total} 处`}
          {result.truncated ? ' · 只显示前 300 条，换个更具体的词' : ''}
        </div>
      )}
    </div>
  )
}
