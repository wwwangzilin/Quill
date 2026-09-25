interface Props {
  items: string[]
  index: number
  onPick: (title: string) => void
}

/**
 * 敲 `[[` 之后的文档选择面板。
 *
 * 以前是贴着光标弹的 252px 小浮层，文档一多就只能靠上下键一条条翻。
 * 现在改成居中的大面板：卡片网格，一眼能扫到更多篇。
 *
 * 焦点始终留在编辑器里（这里从不抢焦点），所以继续打字仍然实时筛选 ——
 * 换成独立界面最容易踩的坑就是「一打开就打不了字了」。
 */
export default function WikiMenu({ items, index, onPick }: Props) {
  return (
    <div className="wiki-mask">
      <div className="wiki-panel">
        <div className="wiki-head">
          <span className="wiki-mark">[[</span>
          <span className="wiki-title">链接到文档</span>
          <span className="grow" />
          <span className="wiki-hint">继续打字筛选 · ↑↓ 移动 · Enter 插入 · Esc 取消</span>
        </div>

        {items.length === 0 ? (
          <div className="wiki-empty">没有匹配的文档</div>
        ) : (
          <div className="wiki-grid">
            {items.map((title, i) => (
              <button
                key={title}
                className={'wiki-card' + (i === index ? ' on' : '')}
                onMouseDown={(e) => {
                  // 别让编辑器失焦，否则后续按键全丢
                  e.preventDefault()
                  e.stopPropagation()
                  onPick(title)
                }}
              >
                <span className="wc-mark">[[</span>
                <span className="wc-title">{title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
