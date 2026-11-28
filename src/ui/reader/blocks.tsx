/**
 * 阅读视图的「块」渲染：把一章的 JSONContent 画成带批注切片的分栏正文。
 *
 * 这几段原来都长在 ReaderView.tsx 里，和分页、朗读、书签挤在一个 1700 行的文件里。
 * 它们只依赖 JSONContent 与 React，一点状态都不碰，所以整段搬出来最安全。
 */
import type { JSONContent } from '@tiptap/core'
import { nodeText, type HiColor } from '../../core/comments'
import { assetUrl } from '../../core/asset'

export interface Mark {
  id: string
  note: string
  resolved: boolean
  color?: HiColor
  from: number
  to: number
}

/* ============================ 渲染：文字 + 批注切片 ============================ */

/**
 * 把 [at, at + text.length) 这段文字按批注区间切开。
 *
 * 偏移是**整章累加**的：`flatText` 把所有 text 节点直接接起来，渲染时
 * 也照同一个顺序往下传 at，所以这里的下标就是那边算出来的下标，
 * 不用再维护一张「字符 → DOM」的映射表。
 */
function sliced(
  text: string,
  at: number,
  marks: Mark[],
  onPick?: (id: string) => void,
): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const end = at + text.length
  const hits = marks.filter((m) => m.from < end && m.to > at).sort((a, b) => a.from - b.from)
  if (!hits.length) return [text]

  let cur = at
  for (const m of hits) {
    const s = Math.max(m.from, cur)
    const e = Math.min(m.to, end)
    if (s > cur) out.push(text.slice(cur - at, s - at))
    if (e > s) {
      out.push(
        <mark
          key={`${m.id}-${s}`}
          className={'has-comment' + (m.resolved ? ' is-resolved' : '') + (m.color ? ` c-${m.color}` : '') + (m.note ? '' : ' no-note')}
          data-comment={m.id}
          title={m.note ? m.note.slice(0, 120) : '高亮'}
          onClick={onPick ? () => onPick(m.id) : undefined}
        >
          {text.slice(s - at, e - at)}
        </mark>,
      )
    }
    cur = Math.max(cur, e)
  }
  if (cur < end) out.push(text.slice(cur - at))
  return out
}

/** 把行内标记一层层包上去 —— 从里往外 */
function decorate(inner: React.ReactNode, marks?: { type: string }[]): React.ReactNode {
  let el = inner
  for (const m of marks ?? []) {
    if (m.type === 'bold') el = <strong>{el}</strong>
    else if (m.type === 'italic') el = <em>{el}</em>
    else if (m.type === 'code') el = <code>{el}</code>
    else if (m.type === 'strike') el = <s>{el}</s>
    else if (m.type === 'highlight') el = <mark>{el}</mark>
    else if (m.type === 'link') el = <u>{el}</u>
  }
  return el
}

/** 行内内容：文字 + 各种标记。标记是一层层套上去的，所以从里往外包 */
function Inline({
  nodes,
  at,
  marks,
  onPick,
}: {
  nodes?: JSONContent[]
  at: number
  marks: Mark[]
  onPick?: (id: string) => void
}) {
  const out: React.ReactNode[] = []
  let cur = at
  ;(nodes ?? []).forEach((n, i) => {
    if (n.type === 'hardBreak') {
      out.push(<br key={i} />)
      return
    }
    if (n.type !== 'text') {
      const t = nodeText(n)
      out.push(<span key={i}>{t}</span>)
      cur += t.length
      return
    }
    const t = n.text ?? ''
    const from = cur
    cur += t.length
    out.push(<span key={i}>{decorate(sliced(t, from, marks, onPick), n.marks)}</span>)
  })
  return <>{out}</>
}

/** 第 index 个子节点之前，本节点已经吃掉了多少字符 */
function offsetBefore(node: JSONContent, index: number): number {
  const kids = node.content ?? []
  let n = 0
  for (let i = 0; i < index; i += 1) n += nodeText(kids[i]).length
  return n
}

/**
 * 把一段的前 fromLine 行切掉。
 *
 * 章与章之间没有空行时，「上一章结尾 \n第N章 xxx \n作者：…」是**同一个段落**，
 * 直接渲染的话每一章开头都会挂着上一章的尾巴。软换行在文档里是 hardBreak 节点，
 * 按它数行就行。切完什么都不剩就返回 null，让调用方跳过这一块。
 *
 * 顺带把「切掉了多少字」报出来 —— 首块的字符偏移要从那儿接着数，
 * 否则这一章的批注底纹会整体串位。
 */
export function cutLeadingLines(
  node: JSONContent,
  fromLine: number,
): { node: JSONContent | null; skipped: number } {
  if (fromLine <= 0) return { node, skipped: 0 }
  const out: JSONContent[] = []
  let line = 0
  let skipped = 0
  for (const child of node.content ?? []) {
    if (child.type === 'hardBreak') {
      line += 1
      continue
    }
    if (line >= fromLine) out.push(child)
    else skipped += nodeText(child).length
  }
  return { node: out.length ? { ...node, content: out } : null, skipped }
}

/**
 * 一个块。
 *
 * 这里刻意不引额外的东西：只认常见的几种，认不出来的降级成段落文本 ——
 * 阅读视图的目标是「把字读清楚」，不是把每种节点都还原得一模一样。
 * 真正的编辑仍然回编辑器里做。
 */
export function Block({
  node,
  at,
  marks,
  onPick,
}: {
  node: JSONContent
  at: number
  marks: Mark[]
  onPick?: (id: string) => void
}) {
  const kids = (node.content ?? []).map((c, i) => (
    <Block key={i} node={c} at={at + offsetBefore(node, i)} marks={marks} onPick={onPick} />
  ))
  switch (node.type) {
    case 'heading': {
      const lv = Math.min(Math.max(Number(node.attrs?.level ?? 2), 2), 4)
      const Tag = (lv === 2 ? 'h2' : lv === 3 ? 'h3' : 'h4') as 'h2' | 'h3' | 'h4'
      return (
        <Tag className="reader-h">
          <Inline nodes={node.content} at={at} marks={marks} onPick={onPick} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p>
          <Inline nodes={node.content} at={at} marks={marks} onPick={onPick} />
        </p>
      )
    case 'blockquote':
      return <blockquote>{kids}</blockquote>
    case 'bulletList':
      return <ul>{kids}</ul>
    case 'orderedList':
      return <ol>{kids}</ol>
    case 'listItem':
      return <li>{kids}</li>
    case 'codeBlock':
      return (
        <pre>
          <code>{sliced(nodeText(node), at, marks, onPick)}</code>
        </pre>
      )
    case 'horizontalRule':
      return <hr />
    case 'image':
      return (
        <img
          className="reader-img"
          src={assetUrl(String(node.attrs?.src ?? ''))}
          alt={String(node.attrs?.alt ?? '')}
        />
      )
    default:
      return (
        <p>
          <Inline nodes={node.content} at={at} marks={marks} onPick={onPick} />
        </p>
      )
  }
}

/* ============================ 主视图 ============================ */

/**
 * 小说阅读视图：左边章节目录，右边正文按栏排。
 *
 * 「分栏」用的是 CSS `columns` + `column-fill: auto`：给一个固定高度的容器，
 * 内容填满第一栏就自动往第二栏流，横向溢出多少就是多少屏。翻页就是把
 * 内容条横向平移一个视口宽 —— 这是电子书阅读器最常见的那套做法，
 * 不用自己算断行位置，中文英文都交给排版引擎。
 *
 * 章节**不自动切**：先让 guessNovel 判断这像不像小说，像就在右下角浮一条提示，
 * 点一下直接进分章模式。默认整篇读 —— 一篇读书笔记被硬切成章节只会更碎，
 * 但也不该拿一个确认框把人拦在门口。
 *
 * 批注走的是和编辑器**同一套东西**：`core/comments.ts` 的定位、
 * `CommentsPanel` 抽屉、`.ai-sel` 浮条、`.has-comment` 底纹。
 * 手感不一致通常不是审美问题，是「另起了一套」。
 */
/**
 * 把「单换行分段」补齐成空行。
 *
 * 从网页扒来的小说几乎都是单换行分段，而 Markdown 要空行才认段落 ——
 * 不补的话整章会挤成一个巨型段落（实测 700 万字那篇，一章 6 万字出来只有一个块）。
 * 只对当前这一章跑，几万字符，很快。
 */
export function softWrapToParagraphs(md: string): string {
  return md.replace(/([^\n])\n(?!\n)/g, '$1\n\n')
}
