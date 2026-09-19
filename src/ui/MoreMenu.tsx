import { useEffect, useRef, useState } from 'react'

export interface MenuItem {
  key: string
  /** 图标字符（跟标题栏其他按钮一个路子，不引图标库） */
  icon: string
  label: string
  /** 右侧小注：快捷键、开关状态之类 */
  hint?: string
  /** 开关类项目：亮起来表示开着 */
  on?: boolean
  disabled?: boolean
  /** 插一条分隔线 */
  divider?: boolean
  onSelect: () => void
}

interface Props {
  items: MenuItem[]
  title?: string
}

/**
 * 标题栏的「⋯ 更多」：把导出 / 历史 / 专注 / 打字机 / 主题这些
 * 不常用的按钮收进一个折叠菜单，标题栏只留写作相关的那几个，
 * 沉浸感干净不少。
 */
export default function MoreMenu({ items, title = '更多' }: Props) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div style={{ position: 'relative' }} ref={box}>
      <button
        className={'btn ghost icon' + (open ? ' on' : '')}
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋯
      </button>

      {open && (
        <div className="menu more" role="menu">
          {items.map((item) => (
            <div key={item.key}>
              {item.divider && <div className="mi-sep" />}
              <button
                className={'mi' + (item.on ? ' on' : '')}
                role="menuitem"
                disabled={item.disabled}
                title={item.hint}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                <span className="mi-icon">{item.icon}</span>
                <span className="mi-label">{item.label}</span>
                {item.hint && <span className="mi-hint">{item.hint}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
