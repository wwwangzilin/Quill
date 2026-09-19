interface Props {
  items: string[]
  index: number
  x: number
  y: number
  onPick: (title: string) => void
}

/** 敲 `[[` 后弹出的文档补全 */
export default function WikiMenu({ items, index, x, y, onPick }: Props) {
  return (
    <div className="slash-menu" style={{ left: x, top: y, width: 252 }}>
      <div className="slash-head">链接到文档</div>
      {items.length === 0 && <div className="slash-empty">没有匹配的文档</div>}
      {items.map((title, i) => (
        <button
          key={title}
          className={'slash-item' + (i === index ? ' on' : '')}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onPick(title)
          }}
        >
          <span className="glyph">[[</span>
          <span className="label">{title}</span>
        </button>
      ))}
      <div className="slash-foot">↑↓ 选择 · Enter 确认 · Esc 关闭</div>
    </div>
  )
}
