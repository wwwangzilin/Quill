import { useEffect, useState } from 'react'
import type { SyntaxItem } from '../editor/syntaxHints'

interface Props {
  item: SyntaxItem
  /** 相对编辑容器的坐标：贴着光标右边缘 */
  x: number
  y: number
  /** 右边放不下时整块翻到光标左侧 */
  flipX: boolean
}

/** 把示例里那一半按语法效果渲染出来 */
function Sample({ item }: { item: SyntaxItem }) {
  const text = item.sampleOut
  switch (item.sampleStyle) {
    case 'bold':
      return <b>{text}</b>
    case 'italic':
      return <i>{text}</i>
    case 'strike':
      return <s>{text}</s>
    case 'mark':
      return <mark>{text}</mark>
    case 'code':
      return <code>{text}</code>
    case 'h1':
      return <span className="sx-h1">{text}</span>
    case 'h2':
      return <span className="sx-h2">{text}</span>
    case 'h3':
      return <span className="sx-h3">{text}</span>
    case 'h4':
      return <span className="sx-h4">{text}</span>
    case 'h5':
      return <span className="sx-h5">{text}</span>
    case 'h6':
      return <span className="sx-h6">{text}</span>
    case 'quote':
      return <span className="sx-quote">{text}</span>
    case 'bullet':
    case 'number':
      return <span className="sx-li">{text}</span>
    case 'todo':
      return (
        <span className="sx-todo">
          <span className="sx-box" />
          {text}
        </span>
      )
    case 'table':
      return (
        <span className="sx-table">
          <span>列</span>
          <span>列</span>
        </span>
      )
    case 'hr':
      return <span className="sx-hr" />
    default:
      return <span>{text}</span>
  }
}

/**
 * 语法提示：光标后面一枚小标签，鼠标移上去展开成一张说明卡。
 *
 * 只有「浮在编辑器上层、不进文档」的东西才能这么干 —— 它既不是装饰也不是内容，
 * 你一继续打字它就没了，所以永远不会污染 .md。
 */
export default function SyntaxHint({ item, x, y, flipX }: Props) {
  const [open, setOpen] = useState(false)

  // 换一个语法就把卡片收起来（免得旧卡还挂在新标签下面）
  useEffect(() => {
    setOpen(false)
  }, [item.token])

  return (
    <div
      className={'syntax-hint' + (flipX ? ' flip' : '') + (open ? ' open' : '')}
      style={{ left: `${x}px`, top: `${y}px` }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="syntax-chip">{item.label}</span>

      {open && (
        <div className="syntax-card">
          <div className="syntax-card-head">
            <code className="syntax-token">{item.token.trim()}</code>
            <span className="syntax-name">{item.label}</span>
          </div>
          <p className="syntax-detail">{item.detail}</p>
          <div className="syntax-sample">
            <code className="syntax-in">{item.sampleIn}</code>
            <span className="syntax-arrow">→</span>
            <span className="syntax-out">
              <Sample item={item} />
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
