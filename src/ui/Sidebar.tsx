import { useEffect, useMemo, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { formatWhen, groupOf } from '../core/time'
import { storage } from '../core/storage'
import { TEMPLATES } from '../core/templates'
import Heatmap from './Heatmap'
import { activeDays, goalProgress, streakDays } from '../core/stats'
import type { DocMeta } from '../core/types'

interface Props {
  docs: DocMeta[]
  activeId: string | null
  hidden: boolean
  tags: string[]
  activeTag: string | null
  stats: Record<string, number>
  /** 每日写作目标（0 = 不设目标） */
  goal: number
  onSelect: (id: string) => void
  onCreate: (templateId: string) => void
  onDelete: (id: string) => void
  onStar: (id: string) => void
  onTagFilter: (tag: string | null) => void
  onOpenTrash: () => void
  /** 文档库：独立一页，用来浏览与筛选全部文档 */
  onOpenLibrary: () => void
}

const ORDER = ['今天', '昨天', '七天内', '更早']

function plainOf(node: JSONContent | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(plainOf).join('')
}

function snippetOf(text: string, kw: string): string {
  const idx = text.toLowerCase().indexOf(kw.toLowerCase())
  if (idx < 0) return ''
  const start = Math.max(0, idx - 14)
  const end = Math.min(text.length, idx + kw.length + 22)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

export default function Sidebar({
  docs,
  activeId,
  hidden,
  tags,
  activeTag,
  stats,
  goal,
  onSelect,
  onCreate,
  onDelete,
  onStar,
  onTagFilter,
  onOpenTrash,
  onOpenLibrary,
}: Props) {
  const [q, setQ] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [tplOpen, setTplOpen] = useState(false)
  const [hits, setHits] = useState<Record<string, string>>({})
  const [searching, setSearching] = useState(false)

  const progress = goalProgress(stats, goal)
  const streak = streakDays(stats)
  const weekActive = activeDays(stats, 7)

  // 标题之外的正文搜索：防抖 260ms，逐篇扫内容
  useEffect(() => {
    const kw = q.trim()
    if (kw.length < 2) {
      setHits({})
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = window.setTimeout(async () => {
      const found: Record<string, string> = {}
      for (const d of docs) {
        if (d.title.toLowerCase().includes(kw.toLowerCase())) continue
        try {
          const doc = await storage.get(d.id)
          const text = plainOf(doc?.content)
          if (text.toLowerCase().includes(kw.toLowerCase())) {
            found[d.id] = snippetOf(text, kw)
          }
        } catch {
          /* 读不出来的跳过 */
        }
      }
      if (!cancelled) {
        setHits(found)
        setSearching(false)
      }
    }, 260)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [q, docs])

  const groups = useMemo(() => {
    const kw = q.trim().toLowerCase()
    let list = kw ? docs.filter((d) => d.title.toLowerCase().includes(kw) || hits[d.id]) : docs
    if (activeTag) list = list.filter((d) => (d.tags ?? []).includes(activeTag))
    const map = new Map<string, DocMeta[]>()
    for (const d of list) {
      const key = groupOf(d.updatedAt)
      const bucket = map.get(key)
      if (bucket) bucket.push(d)
      else map.set(key, [d])
    }
    return ORDER.filter((k) => map.has(k)).map((k) => ({ key: k, items: map.get(k)! }))
  }, [docs, q, hits, activeTag])

  const total = groups.reduce((n, g) => n + g.items.length, 0)
  const kw = q.trim()
  let stagger = 0

  return (
    <aside className={'sidebar' + (hidden ? ' hidden' : '')}>
      <div className="sidebar-head">
        <div className="new-wrap">
          <button className="btn primary" onClick={() => setTplOpen((v) => !v)}>
            ＋ 新建文档
          </button>
          {tplOpen && (
            <div className="menu tpl-menu">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  className="tpl"
                  onClick={() => {
                    setTplOpen(false)
                    onCreate(t.id)
                  }}
                >
                  <span className="glyph">{t.glyph}</span>
                  <span>{t.name}</span>
                  <span className="tips">{t.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="search">
          {searching ? (
            <span className="spinner" style={{ width: 11, height: 11 }} />
          ) : (
            <span style={{ color: 'var(--text-3)', fontSize: 12 }}>⌕</span>
          )}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标题或正文…"
            spellCheck={false}
          />
          {q && (
            <button className="btn ghost icon" onClick={() => setQ('')} title="清空">
              ×
            </button>
          )}
        </div>
        {tags.length > 0 && (
          <div className="tag-row">
            {activeTag && (
              <span className="tag on" onClick={() => onTagFilter(null)} title="清除筛选">
                {activeTag} ×
              </span>
            )}
            {tags
              .filter((t) => t !== activeTag)
              .map((t) => (
                <span key={t} className="tag" onClick={() => onTagFilter(t)}>
                  {t}
                </span>
              ))}
          </div>
        )}
      </div>

      <div className="doc-list">
        {total === 0 && (
          <div className="empty-hint">
            {kw ? '没搜到东西，杂鱼～' : '尚无文档 · 点上方「＋」新建一篇'}
          </div>
        )}

        {groups.map((g) => (
          <div key={g.key}>
            <div className="group-label">{g.key}</div>
            {g.items.map((d) => {
              const delay = `${Math.min(stagger++ * 22, 260)}ms`
              return (
                <div
                  key={d.id}
                  className={'doc-item' + (d.id === activeId ? ' active' : '')}
                  style={{ animationDelay: delay }}
                  onClick={() => {
                    setConfirmId(null)
                    onSelect(d.id)
                  }}
                >
                  <div className="row">
                    {d.starred && <span className="star">★</span>}
                    <span className="t">{d.title || '无标题'}</span>
                  </div>
                  <div className="sub">{hits[d.id] ? hits[d.id] : formatWhen(d.updatedAt)}</div>
                  {(d.tags?.length ?? 0) > 0 && (
                    <div className="tag-row">
                      {d.tags!.map((t) => (
                        <span
                          key={t}
                          className={'tag' + (activeTag === t ? ' on' : '')}
                          onClick={(e) => {
                            e.stopPropagation()
                            onTagFilter(activeTag === t ? null : t)
                          }}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="tools" onClick={(e) => e.stopPropagation()}>
                    <button title={d.starred ? '取消收藏' : '收藏'} onClick={() => onStar(d.id)}>
                      {d.starred ? '★' : '☆'}
                    </button>
                    {confirmId === d.id ? (
                      <button
                        title="再点一次确认删除"
                        style={{ color: 'var(--accent-3)' }}
                        onClick={() => {
                          setConfirmId(null)
                          onDelete(d.id)
                        }}
                      >
                        确认?
                      </button>
                    ) : (
                      <button title="删除" onClick={() => setConfirmId(d.id)}>
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="side-foot">
        <div className="row">
          <span>文档</span>
          <span className="grow" />
          <button
            className="btn ghost icon"
            title="文档库 · 浏览与筛选全部文档"
            onClick={onOpenLibrary}
          >
            ▤
          </button>
          <button className="btn ghost icon" title="回收站" onClick={onOpenTrash}>
            ♻
          </button>
        </div>

        {/* 今日进度 + 连续天数：热力图光看图没数，这儿给两个具体数字 */}
        <div className="goal">
          <div className="goal-line">
            <span className="goal-today">
              今天 <b>{progress.today}</b> 字
            </span>
            <span className="grow" />
            {progress.goal > 0 ? (
              <span className={'goal-rest' + (progress.done ? ' done' : '')}>
                {progress.done ? '已达标 ✓' : `还差 ${progress.remain}`}
              </span>
            ) : (
              <span className="goal-rest">未设目标</span>
            )}
          </div>
          {progress.goal > 0 && (
            <div className="goal-bar">
              <span style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
            </div>
          )}
          <div className="goal-line">
            <span className="goal-streak">
              {streak > 0 ? `连续写作 ${streak} 天` : '今天开个头吧'}
            </span>
            <span className="grow" />
            <span className="goal-rest">近 7 天写了 {weekActive} 天</span>
          </div>
        </div>

        <Heatmap stats={stats} weeks={12} />
      </div>
    </aside>
  )
}
