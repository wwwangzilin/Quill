import { useRef, useState } from 'react'
import type { DocMeta } from '../core/types'

/**
 * 书架排序面板：一列书名，拖动调顺序（HTML5 拖放）；
 * 每行还有 ↑ ↓ 按钮，触屏 / 键盘 / 拖不动的时候用它们。
 */
export default function ShelfSorter({
  docs,
  onMove,
  onReset,
  customized,
  onClose,
}: {
  docs: DocMeta[]
  onMove: (from: number, to: number) => void
  onReset: () => void
  customized: boolean
  onClose: () => void
}) {
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  return (
    <div className="shelf-sorter">
      <div className="shelf-sorter-head">
        <span>拖动调整顺序</span>
        <span className="grow" />
        {customized && (
          <button className="btn ghost mini" onClick={onReset} title="恢复成和文档列表一样的顺序">
            恢复默认
          </button>
        )}
        <button className="btn ghost mini" onClick={onClose}>
          完成
        </button>
      </div>
      <div className="shelf-sorter-list" ref={listRef}>
        {docs.map((d, i) => (
          <div
            key={d.id}
            className={'shelf-sorter-row' + (drag === i ? ' dragging' : '') + (over === i && drag !== null && drag !== i ? ' over' : '')}
            draggable
            onDragStart={(e) => {
              setDrag(i)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', d.id)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              if (over !== i) setOver(i)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (drag !== null && drag !== i) onMove(drag, i)
              setDrag(null)
              setOver(null)
            }}
            onDragEnd={() => {
              setDrag(null)
              setOver(null)
            }}
          >
            <span className="shelf-sorter-grip" aria-hidden="true">
              ⋮⋮
            </span>
            <span className="shelf-sorter-title">{d.title || '未命名'}</span>
            <button className="btn ghost mini" disabled={i === 0} onClick={() => onMove(i, i - 1)} aria-label="上移">
              ↑
            </button>
            <button
              className="btn ghost mini"
              disabled={i === docs.length - 1}
              onClick={() => onMove(i, i + 1)}
              aria-label="下移"
            >
              ↓
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
