import { useMemo, useState } from 'react'
import type { DocMeta } from '../core/types'

interface Props {
  docs: DocMeta[]
  currentId: string | null
  onOpen: (id: string) => void
  onCreate: () => void
  onClose: () => void
  onStar: (id: string, starred: boolean) => void
  /** 侧栏默认收起了，回收站的入口挪到这里 */
  onOpenTrash: () => void
}

type SortKey = 'title' | 'updated' | 'created' | 'chars'
type Filter = { kind: 'all' } | { kind: 'star' } | { kind: 'tag'; tag: string }

/** 日期写成人话：今天/昨天带时刻，更早给完整日期 */
function fullDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const today = new Date()
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return `今天 ${clock}`
  const y = new Date(today)
  y.setDate(y.getDate() - 1)
  if (sameDay(d, y)) return `昨天 ${clock}`
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${clock}`
}

function sizeLabel(n?: number): string {
  if (!n) return '—'
  return n < 1000 ? `${n} 字` : `${(n / 1000).toFixed(1)}k 字`
}

/**
 * 文档库。
 *
 * 照 Word 的「最近使用的文档」来：**一整个通栏的文件列表**，没有左侧栏。
 * 名称、标签、修改日期、字数四列，点列头排序；筛选收在顶上那一行。
 */
export default function DocLibrary({
  docs,
  currentId,
  onOpen,
  onCreate,
  onClose,
  onStar,
  onOpenTrash,
}: Props) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>({ kind: 'all' })
  const [sort, setSort] = useState<SortKey>('updated')
  const [asc, setAsc] = useState(false)

  const tags = useMemo(() => {
    const set = new Set<string>()
    for (const d of docs) for (const t of d.tags ?? []) set.add(t)
    return [...set].sort()
  }, [docs])

  const starredCount = useMemo(() => docs.filter((d) => d.starred).length, [docs])
  const totalChars = useMemo(() => docs.reduce((n, d) => n + (d.chars ?? 0), 0), [docs])

  const rows = useMemo(() => {
    const key = q.trim().toLowerCase()
    const filtered = docs.filter((d) => {
      if (filter.kind === 'star' && !d.starred) return false
      if (filter.kind === 'tag' && !(d.tags ?? []).includes(filter.tag)) return false
      if (!key) return true
      return (
        d.title.toLowerCase().includes(key) ||
        (d.tags ?? []).some((t) => t.toLowerCase().includes(key))
      )
    })
    return [...filtered].sort((a, b) => {
      let r = 0
      if (sort === 'title') r = a.title.localeCompare(b.title, 'zh')
      else if (sort === 'created') r = a.createdAt - b.createdAt
      else if (sort === 'chars') r = (a.chars ?? 0) - (b.chars ?? 0)
      else r = a.updatedAt - b.updatedAt
      return asc ? r : -r
    })
  }, [docs, q, filter, sort, asc])

  const pickSort = (key: SortKey) => {
    if (sort === key) setAsc((v) => !v)
    else {
      setSort(key)
      setAsc(key === 'title')
    }
  }
  const arrow = (key: SortKey) => (sort === key ? (asc ? ' ▲' : ' ▼') : '')

  return (
    <div className="library-view">
      <div className="library-head">
        <div className="library-title">文档库</div>
        <span className="grow" />
        <input
          className="library-search"
          placeholder="搜索标题或标签"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <button className="btn" onClick={onCreate}>
          ＋ 新建
        </button>
        <button className="btn ghost" onClick={onOpenTrash} title="回收站">
          ♻ 回收站
        </button>
        <button className="btn ghost" onClick={onClose}>
          返回写作
        </button>
      </div>

      {/* 筛选收在一行里，不再占一整个侧栏 */}
      <div className="library-filters">
        <button
          className={'fbtn' + (filter.kind === 'all' ? ' on' : '')}
          onClick={() => setFilter({ kind: 'all' })}
        >
          全部 <em>{docs.length}</em>
        </button>
        <button
          className={'fbtn' + (filter.kind === 'star' ? ' on' : '')}
          onClick={() => setFilter({ kind: 'star' })}
        >
          ★ 星标 <em>{starredCount}</em>
        </button>
        {tags.length > 0 && <span className="fsep" />}
        {tags.map((t) => {
          const n = docs.filter((d) => (d.tags ?? []).includes(t)).length
          const on = filter.kind === 'tag' && filter.tag === t
          return (
            <button
              key={t}
              className={'fbtn' + (on ? ' on' : '')}
              onClick={() => setFilter({ kind: 'tag', tag: t })}
            >
              {t} <em>{n}</em>
            </button>
          )
        })}
      </div>

      <div className="library-list">
        <div className="list-head">
          <button className="lh name" onClick={() => pickSort('title')}>
            名称{arrow('title')}
          </button>
          <button className="lh tags" onClick={() => pickSort('created')}>
            创建{arrow('created')}
          </button>
          <button className="lh date" onClick={() => pickSort('updated')}>
            修改日期{arrow('updated')}
          </button>
          <button className="lh size" onClick={() => pickSort('chars')}>
            字数{arrow('chars')}
          </button>
          <span className="lh star" />
        </div>

        <div className="list-body">
          {rows.length === 0 ? (
            <div className="list-empty">
              {docs.length === 0 ? '还没有文档，点右上角「＋ 新建」写第一篇' : '没有符合条件的文档'}
            </div>
          ) : (
            rows.map((d) => (
              <div
                key={d.id}
                className={'list-row' + (d.id === currentId ? ' current' : '')}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(d.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpen(d.id)
                }}
              >
                <span className="lr-name" title={d.title}>
                  <span className="lr-doc">📄</span>
                  {d.title || '未命名'}
                  {(d.tags ?? []).length > 0 && (
                    <span className="lr-tagset">
                      {(d.tags ?? []).slice(0, 3).map((t) => (
                        <span key={t} className="lr-tag">
                          {t}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                <span className="lr-created">{fullDate(d.createdAt)}</span>
                <span className="lr-date">{fullDate(d.updatedAt)}</span>
                <span className="lr-size">{sizeLabel(d.chars)}</span>
                <button
                  className={'lr-star' + (d.starred ? ' on' : '')}
                  title={d.starred ? '取消星标' : '加星标'}
                  onClick={(e) => {
                    e.stopPropagation()
                    onStar(d.id, !d.starred)
                  }}
                >
                  {d.starred ? '★' : '☆'}
                </button>
              </div>
            ))
          )}
        </div>

        <div className="list-foot">
          <span>
            共 {rows.length} 篇
            {rows.length !== docs.length && ` · 已筛选，全部 ${docs.length} 篇`}
          </span>
          <span className="grow" />
          <span>合计 {totalChars.toLocaleString('zh-CN')} 字</span>
        </div>
      </div>
    </div>
  )
}
