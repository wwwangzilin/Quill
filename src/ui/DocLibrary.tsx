import { useMemo, useState } from 'react'
import type { DocMeta } from '../core/types'

interface Props {
  docs: DocMeta[]
  currentId: string | null
  onOpen: (id: string) => void
  onCreate: () => void
  onClose: () => void
  onStar: (id: string, starred: boolean) => void
}

type SortKey = 'updated' | 'created' | 'title' | 'chars'

/** 相对时间，够用就行 */
function when(ts: number): string {
  const diff = Date.now() - ts
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function sizeLabel(n?: number): string {
  if (!n) return '空'
  return n < 1000 ? `${n} 字` : `${(n / 1000).toFixed(1)}k 字`
}

/**
 * 文档库：独立一页，用来浏览和挑文档。
 *
 * 和侧栏分工不同 —— 侧栏适合「在手头这几篇之间来回切」，
 * 这里适合「翻一翻到底都写过些什么」：卡片够大、能看字数与时间、能按标签捞。
 */
export default function DocLibrary({
  docs,
  currentId,
  onOpen,
  onCreate,
  onClose,
  onStar,
}: Props) {
  const [q, setQ] = useState('')
  const [onlyStar, setOnlyStar] = useState(false)
  const [tag, setTag] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('updated')

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const d of docs) for (const t of d.tags ?? []) set.add(t)
    return [...set].sort()
  }, [docs])

  const list = useMemo(() => {
    const key = q.trim().toLowerCase()
    const filtered = docs.filter((d) => {
      if (onlyStar && !d.starred) return false
      if (tag && !(d.tags ?? []).includes(tag)) return false
      if (!key) return true
      return (
        d.title.toLowerCase().includes(key) ||
        (d.tags ?? []).some((t) => t.toLowerCase().includes(key))
      )
    })
    return [...filtered].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'zh')
      if (sort === 'created') return b.createdAt - a.createdAt
      if (sort === 'chars') return (b.chars ?? 0) - (a.chars ?? 0)
      return b.updatedAt - a.updatedAt
    })
  }, [docs, q, onlyStar, tag, sort])

  const totalChars = useMemo(() => docs.reduce((n, d) => n + (d.chars ?? 0), 0), [docs])

  return (
    <div className="library-view">
      <div className="library-head">
        <div className="library-title">
          文档库
          <span className="library-count">
            {docs.length} 篇 · 共 {totalChars.toLocaleString('zh-CN')} 字
          </span>
        </div>
        <span className="grow" />
        <button className="btn" onClick={onCreate}>
          ＋ 新建
        </button>
        <button className="btn ghost" onClick={onClose}>
          返回写作
        </button>
      </div>

      <div className="library-bar">
        <input
          className="library-search"
          placeholder="搜索标题或标签"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <button
          className={'chip' + (onlyStar ? ' on' : '')}
          onClick={() => setOnlyStar((v) => !v)}
        >
          ★ 星标
        </button>
        <span className="grow" />
        <select
          className="library-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="排序方式"
        >
          <option value="updated">最近修改</option>
          <option value="created">最近创建</option>
          <option value="title">按标题</option>
          <option value="chars">按字数</option>
        </select>
      </div>

      {allTags.length > 0 && (
        <div className="library-tags">
          <button className={'chip' + (tag === null ? ' on' : '')} onClick={() => setTag(null)}>
            全部
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              className={'chip' + (tag === t ? ' on' : '')}
              onClick={() => setTag(tag === t ? null : t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {list.length === 0 ? (
        <div className="library-empty">
          {docs.length === 0 ? '还没有文档，点右上角「＋ 新建」写第一篇' : '没有符合条件的文档'}
        </div>
      ) : (
        <div className="library-grid">
          {list.map((d) => (
            <div
              key={d.id}
              className={'doc-card' + (d.id === currentId ? ' current' : '')}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(d.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onOpen(d.id)
              }}
            >
              <div className="dc-top">
                <span className="dc-title">{d.title || '未命名'}</span>
                <button
                  className={'dc-star' + (d.starred ? ' on' : '')}
                  title={d.starred ? '取消星标' : '加星标'}
                  onClick={(e) => {
                    e.stopPropagation()
                    onStar(d.id, !d.starred)
                  }}
                >
                  {d.starred ? '★' : '☆'}
                </button>
              </div>

              {(d.tags ?? []).length > 0 && (
                <div className="dc-tags">
                  {(d.tags ?? []).map((t) => (
                    <span key={t} className="dc-tag">
                      {t}
                    </span>
                  ))}
                </div>
              )}

              <div className="dc-foot">
                <span>{when(d.updatedAt)}</span>
                <span className="grow" />
                <span>{sizeLabel(d.chars)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
