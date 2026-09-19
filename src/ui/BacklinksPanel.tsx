import { useCallback, useEffect, useState } from 'react'
import type { DocMeta } from '../core/types'
import { findBacklinks, type BacklinkHit } from '../core/backlinks'
import { formatWhen } from '../core/time'

interface Props {
  doc: { id: string; title: string }
  docs: DocMeta[]
  onOpen: (id: string) => void
}

/**
 * 反向链接条：贴在正文底下，告诉你「谁引用了这一篇」。
 * 默认折着 —— 展开才去扫全库，不然每开一篇都要读一遍所有文档。
 */
export default function BacklinksPanel({ doc, docs, onOpen }: Props) {
  const [open, setOpen] = useState(false)
  const [hits, setHits] = useState<BacklinkHit[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setHits(await findBacklinks({ id: doc.id, title: doc.title }, docs))
    } finally {
      setLoading(false)
    }
  }, [doc.id, doc.title, docs])

  // 换文档就收起来，免得串味
  useEffect(() => {
    setOpen(false)
    setHits(null)
  }, [doc.id])

  useEffect(() => {
    if (open && hits === null) void load()
  }, [open, hits, load])

  const count = hits?.length ?? 0

  return (
    <div className={'backlinks' + (open ? ' open' : '')}>
      <button
        className="backlinks-head"
        onClick={() => setOpen((v) => !v)}
        title={open ? '收起' : '看看谁引用了这一篇'}
      >
        <span className="backlinks-caret">{open ? '▾' : '▸'}</span>
        <span>反向链接</span>
        <span className="backlinks-count">
          {loading ? '扫描中…' : hits === null ? '' : count > 0 ? `${count} 篇引用` : '还没有人引用'}
        </span>
      </button>

      {open && (
        <div className="backlinks-body">
          {hits !== null && hits.length === 0 && (
            <div className="backlinks-empty">
              在别的文档里写 <code>[[{doc.title}]]</code> 就会出现在这里。
            </div>
          )}
          {hits?.map((hit) => (
            <button key={hit.id} className="backlink" onClick={() => onOpen(hit.id)}>
              <div className="backlink-top">
                <span className="backlink-title">{hit.title}</span>
                <span className="backlink-when">{formatWhen(hit.updatedAt)}</span>
              </div>
              {hit.snippets.map((s, i) => (
                <div className="backlink-snippet" key={i}>
                  {s}
                </div>
              ))}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
