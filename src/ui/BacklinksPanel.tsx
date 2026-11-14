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
 * 反向链接：并进底部状态栏的一个可展开项。
 *
 * 以前它自己占正文底下的一整行，而状态栏也在底部 —— 两条各占一行太浪费。
 * 现在收进状态栏右侧，点一下**向上弹出**内容，带展开动画。
 *
 * 懒加载照旧：不展开就不扫全库，否则每开一篇文档都得把所有 .md 读一遍。
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

  // 展开时按 Esc 收起来
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const count = hits?.length ?? 0

  return (
    <div className={'backlinks' + (open ? ' open' : '')}>
      <button
        className="backlinks-head"
        onClick={() => setOpen((v) => !v)}
        title={open ? '收起' : '看看谁引用了这一篇'}
        aria-expanded={open}
      >
        <span>反向链接</span>
        <span className="backlinks-count">
          {loading ? '扫描中…' : hits === null ? '' : count > 0 ? `${count} 篇引用` : '暂无引用'}
        </span>
        <span className="backlinks-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {/*
        面板始终挂在 DOM 里，靠 .open 切换透明度与位移 ——
        条件渲染的话就没有可过渡的起止状态，动画会直接跳。
      */}
      <div className="backlinks-body" role="region" aria-hidden={!open}>
        {open && hits !== null && hits.length === 0 && (
          <div className="backlinks-empty">
            在别的文档里写 <code>[[{doc.title}]]</code> 就会出现在这里。
          </div>
        )}
        {open &&
          hits?.map((hit) => (
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
    </div>
  )
}
