/**
 * 阅读视图左侧的章节目录。
 *
 * 单独一个文件是因为它有一件自己的事：**虚拟化**。
 * 933 章那本书打开目录时，原来是一次性挂 933 个按钮 —— 打开要卡一下、
 * 滚动也沉。现在只渲染视口附近的几十项（外加一点余量），总高度用一条
 * 占位撑开，滚动条长度和位置都不变。
 *
 * 行高必须是固定的，否则算不出来：样式里 `.reader-toc-item` 定了 32px。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface TocChapter {
  title: string
  /** 这一章是不是从「第X章」这类文字里猜出来的（标题上会有提示） */
  inferred?: boolean
}

interface Props {
  chapters: TocChapter[]
  /** 过滤后要显示的章节下标（不过滤就是全部） */
  hits: number[]
  /** 当前读到第几章 */
  current: number
  readSet: Set<string>
  readPercent: number
  query: string
  onQuery: (q: string) => void
  onPick: (index: number) => void
  /** 跳到第一个未读 */
  onJumpUnread: () => void
}

/** 与样式 `.reader-toc-item` 的高度必须一致 */
const ROW = 32
/** 视口上下各多渲染几行，快速滚动时不会露白 */
const OVERSCAN = 6

export default function Toc({
  chapters,
  hits,
  current,
  readSet,
  readPercent,
  query,
  onQuery,
  onPick,
  onJumpUnread,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [boxH, setBoxH] = useState(480)

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBoxH(el.clientHeight))
    ro.observe(el)
    setBoxH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  // 换成这本书 / 跳到别的章之后，把当前章滚进视野
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    const pos = hits.indexOf(current)
    if (pos < 0) return
    const top = pos * ROW
    if (top < el.scrollTop || top + ROW > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 2)
    }
    // 只在「当前章 / 筛选结果」变化时纠位置，不跟着每一次滚动跑
  }, [current, hits])

  const total = hits.length
  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN)
  const last = Math.min(total, Math.ceil((scrollTop + boxH) / ROW) + OVERSCAN)
  const visible = hits.slice(first, last)

  return (
    <aside className="reader-toc">
      <div className="reader-toc-head">
        章节目录
        <span className="reader-toc-count">
          {chapters.length} 章 · 已读 {readPercent}%
        </span>
      </div>
      <div className="reader-toc-search">
        <input
          value={query}
          placeholder="搜章名，或输序号跳章"
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits.length) onPick(hits[0])
          }}
          spellCheck={false}
        />
        <button className="btn ghost mini" title="跳到第一个还没读完的章" onClick={onJumpUnread}>
          未读
        </button>
      </div>
      <div
        className="reader-toc-list"
        ref={listRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {total === 0 && <div className="reader-toc-empty">没有匹配的章节</div>}
        {total > 0 && (
          <div className="reader-toc-vlist" style={{ height: total * ROW }}>
            {visible.map((i, k) => {
              const c = chapters[i]
              const isRead = readSet.has(c.title)
              return (
                <button
                  key={`${c.title}-${i}`}
                  className={'reader-toc-item' + (i === current ? ' on' : '') + (isRead && i !== current ? ' read' : '')}
                  style={{ top: (first + k) * ROW }}
                  onClick={() => onPick(i)}
                  title={c.inferred ? '这一章是从「第X章」这类文字里认出来的' : c.title}
                >
                  <span className="reader-toc-n">{isRead && i !== current ? '✓' : i + 1}</span>
                  <span className="reader-toc-title">{c.title}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}
