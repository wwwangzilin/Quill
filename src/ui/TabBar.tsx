import type { DocMeta } from '../core/types'

/**
 * 顶部的文档标签栏。
 *
 * 只是「打开过哪些篇」的一排快捷方式：点一下切过去、中键或 × 关掉。
 * 真正的文档状态仍在 useDocSession 里 —— 标签不另存一份内容，
 * 免得出现「标签里是旧的、磁盘上是新的」这种两套真相。
 */
interface Props {
  tabs: string[]
  docs: DocMeta[]
  activeId: string | null
  splitId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onToggleSplit: () => void
}

export default function TabBar({
  tabs,
  docs,
  activeId,
  splitId,
  onSelect,
  onClose,
  onToggleSplit,
}: Props) {
  const items = tabs
    .map((id) => docs.find((d) => d.id === id))
    .filter((d): d is DocMeta => Boolean(d))
  if (items.length === 0) return null

  return (
    <div className="tabbar">
      <div className="tabbar-list">
        {items.map((d) => (
          <div
            key={d.id}
            className={'tab' + (d.id === activeId ? ' on' : '')}
            role="tab"
            aria-selected={d.id === activeId}
            title={d.title}
            onClick={() => onSelect(d.id)}
            onAuxClick={(e) => {
              // 中键关掉 —— 浏览器标签那套肌肉记忆
              if (e.button === 1) {
                e.preventDefault()
                onClose(d.id)
              }
            }}
          >
            <span className="tab-title">{d.title || '未命名'}</span>
            <button
              className="tab-x"
              title="关闭（Ctrl+W）"
              onClick={(e) => {
                e.stopPropagation()
                onClose(d.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <span className="grow" />
      <button
        className={'btn ghost icon' + (splitId ? ' on' : '')}
        title={splitId ? '关掉右侧对照' : '左右分屏对照（只读）'}
        onClick={onToggleSplit}
      >
        ◫
      </button>
    </div>
  )
}
