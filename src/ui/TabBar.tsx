import { useEffect, useRef, useState } from 'react'
import type { DocMeta } from '../core/types'
import { hintOf } from '../core/shortcuts'
import { Icon } from './Icon'

/**
 * 顶部的文档标签栏。
 *
 * 只负责「打开过哪些篇」的排列与交互；文档内容仍然只在 useDocSession 里，
 * 标签不复制一份数据，免得出现「标签里是旧的、磁盘上是新的」两套真相。
 *
 * 键盘：←/→ 在标签之间移动焦点（**不切换文档**），Enter 打开，Delete 关闭。
 * 鼠标：点选、中键关闭、右键菜单、拖动排序。
 */

interface Props {
  /** 已排好序的标签（固定的在前面） */
  tabs: string[]
  docs: DocMeta[]
  pinned: string[]
  activeId: string | null
  splitId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCloseOthers: (id: string) => void
  onCloseRight: (id: string) => void
  onTogglePin: (id: string) => void
  /** 拖动排序：把 from 位置的标签放到 to 位置 */
  onReorder: (from: number, to: number) => void
  onToggleSplit: () => void
}

export default function TabBar({
  tabs,
  docs,
  pinned,
  activeId,
  splitId,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseRight,
  onTogglePin,
  onReorder,
  onToggleSplit,
}: Props) {
  const items = tabs
    .map((id) => docs.find((d) => d.id === id))
    .filter((d): d is DocMeta => Boolean(d))
  /** 右键菜单：对着哪一个标签、在什么位置弹 */
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  /** 拖动中：源位置与当前悬停的位置（用来画插入线） */
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  if (items.length === 0) return null

  const focusTab = (id: string) => tabRefs.current.get(id)?.focus()

  /** 键盘导航：只移动焦点，不切文档 —— 方向键不该把正在写的东西换掉 */
  const onKeyDown = (e: React.KeyboardEvent, i: number, item: DocMeta) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const delta = e.key === 'ArrowLeft' ? -1 : 1
      const next = items[(i + delta + items.length) % items.length]
      focusTab(next.id)
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(item.id)
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onClose(item.id)
      return
    }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault()
      const rect = tabRefs.current.get(item.id)?.getBoundingClientRect()
      if (rect) setMenu({ id: item.id, x: rect.left, y: rect.bottom + 4 })
    }
  }

  const menuIndex = menu ? items.findIndex((d) => d.id === menu.id) : -1

  return (
    <div className="tabbar" role="tablist" aria-label="打开的文档">
      <div className="tabbar-list" ref={listRef}>
        {items.map((d, i) => {
          const isPinned = pinned.includes(d.id)
          const dropBefore = drag && drag.over === i && drag.from > i
          const dropAfter = drag && drag.over === i && drag.from < i
          return (
            <div
              key={d.id}
              ref={(el) => {
                if (el) tabRefs.current.set(d.id, el)
                else tabRefs.current.delete(d.id)
              }}
              role="tab"
              aria-selected={d.id === activeId}
              aria-controls="quill-editor"
              tabIndex={d.id === activeId ? 0 : -1}
              draggable
              className={
                'tab' +
                (d.id === activeId ? ' on' : '') +
                (isPinned ? ' pinned' : '') +
                (drag?.from === i ? ' dragging' : '') +
                (dropBefore ? ' drop-before' : '') +
                (dropAfter ? ' drop-after' : '')
              }
              title={`${d.title || '未命名'}${isPinned ? '（已固定）' : ''}`}
              onClick={() => onSelect(d.id)}
              onKeyDown={(e) => onKeyDown(e, i, d)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  onClose(d.id)
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ id: d.id, x: e.clientX, y: e.clientY })
              }}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', d.id)
                setDrag({ from: i, over: i })
              }}
              onDragOver={(e) => {
                if (!drag) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (drag.over !== i) setDrag({ ...drag, over: i })
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (drag && drag.from !== i) onReorder(drag.from, i)
                setDrag(null)
              }}
              onDragEnd={() => setDrag(null)}
            >
              {isPinned && (
                <span className="tab-pin" aria-hidden="true">
                  <Icon name="pin" />
                </span>
              )}
              <span className="tab-title">{d.title || '未命名'}</span>
              {!isPinned && (
                <button
                  className="tab-x"
                  title={`关闭（${hintOf('closeTab')}）`}
                  aria-label={`关闭 ${d.title || '未命名'}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(d.id)
                  }}
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
      </div>
      <span className="grow" />
      <button
        className={'btn ghost icon' + (splitId ? ' on' : '')}
        title={splitId ? '关掉右侧对照' : '左右分屏对照（只读）'}
        onClick={onToggleSplit}
      >
        ◫
      </button>

      {menu && menuIndex >= 0 && (
        <div
          className="tab-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              onClose(menu.id)
              setMenu(null)
            }}
          >
            关闭
          </button>
          <button
            disabled={items.length <= 1}
            onClick={() => {
              onCloseOthers(menu.id)
              setMenu(null)
            }}
          >
            关闭其他标签页
          </button>
          <button
            disabled={menuIndex >= items.length - 1}
            onClick={() => {
              onCloseRight(menu.id)
              setMenu(null)
            }}
          >
            关闭右侧标签页
          </button>
          <button
            onClick={() => {
              onTogglePin(menu.id)
              setMenu(null)
            }}
          >
            {pinned.includes(menu.id) ? '取消固定' : '固定标签页'}
          </button>
        </div>
      )}
    </div>
  )
}
