import { useRef, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/**
 * 公式与脚注。
 *
 * 共同的前提：**纯 Markdown 是唯一真相源**。所以这两种节点都把「原文」原样存在
 * attrs 里（`latex` / `label` / `text`），序列化时按原字符写回去 ——
 * 只多做一件事：把 `$…$` 渲染成公式、把 `[^1]` 渲染成角标。
 *
 * 公式点一下回到源码：弹一个小输入框，回车写回 attrs，撤销栈照常。
 */

/* ------------------------------ 行内公式 ------------------------------ */

function renderMath(latex: string, display: boolean) {
  try {
    return katex.renderToString(latex.trim(), {
      displayMode: display,
      throwOnError: false,
      errorColor: '#c2547f',
      strict: false,
    })
  } catch {
    /* 兜底：渲染不出来就把原文露出来，别把整段吃掉 */
    return `<code class="math-error">${latex.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c)}</code>`
  }
}

/** 点开后的小编辑框：回车确认，Esc 取消 */
function MathEditor({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string
  onSubmit: (v: string) => void
  onCancel: () => void
}) {
  const [v, setV] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  return (
    <span className="math-edit">
      <input
        ref={ref}
        autoFocus
        value={v}
        spellCheck={false}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          // 公式里到处是括号和美元符，别让快捷键抢走
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            onSubmit(v)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        onBlur={() => onSubmit(v)}
      />
    </span>
  )
}

function InlineMathView({ node, updateAttributes, editor }: NodeViewProps) {
  const [editing, setEditing] = useState(false)
  const latex = String(node.attrs.latex ?? '')
  return (
    <NodeViewWrapper as="span" className="math-inline" data-latex={latex}>
      {editing ? (
        <MathEditor
          initial={latex}
          onSubmit={(v) => {
            setEditing(false)
            if (v !== latex) updateAttributes({ latex: v })
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <span
          className="math-render"
          title="点一下改公式"
          onClick={() => {
            if (editor.isEditable) setEditing(true)
          }}
          dangerouslySetInnerHTML={{ __html: renderMath(latex, false) }}
        />
      )}
    </NodeViewWrapper>
  )
}

function BlockMathView({ node, updateAttributes, editor }: NodeViewProps) {
  const [editing, setEditing] = useState(false)
  const latex = String(node.attrs.latex ?? '')
  return (
    <NodeViewWrapper as="div" className="math-block" data-latex={latex}>
      {editing ? (
        <MathEditor
          initial={latex}
          onSubmit={(v) => {
            setEditing(false)
            if (v !== latex) updateAttributes({ latex: v })
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div
          className="math-render"
          title="点一下改公式"
          onClick={() => {
            if (editor.isEditable) setEditing(true)
          }}
          dangerouslySetInnerHTML={{ __html: renderMath(latex, true) }}
        />
      )}
    </NodeViewWrapper>
  )
}

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? '',
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-latex': attrs.latex }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-math-inline]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-math-inline': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(InlineMathView)
  },
})

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? '',
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-latex': attrs.latex }),
      },
      /** 原来是不是「多行 $$」写法 —— 写回 Markdown 时按原样，不改用户的排版 */
      multi: { default: false, renderHTML: () => ({}) },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-math-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-math-block': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(BlockMathView)
  },
})

/* ------------------------------ 脚注 ------------------------------ */

function FootnoteRefView({ node, editor }: NodeViewProps) {
  const label = String(node.attrs.label ?? '')
  // 文档里第几个引用（1 起）。用 doc.descendants 按顺序数。
  let index = 0
  let found = 0
  editor.state.doc.descendants((n) => {
    if (n.type.name !== 'footnoteRef') return true
    index += 1
    if (n.attrs.label === label && !found) found = index
    return true
  })
  const num = found || 1
  return (
    <NodeViewWrapper as="sup" className="fn-ref" data-label={label} contentEditable={false}>
      <a
        title={`脚注 ${label}`}
        onClick={(e) => {
          e.preventDefault()
          document
            .querySelector(`[data-fn-def="${CSS.escape(label)}"]`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }}
      >
        {num}
      </a>
    </NodeViewWrapper>
  )
}

function FootnoteDefView({ node }: NodeViewProps) {
  const label = String(node.attrs.label ?? '')
  const text = String(node.attrs.text ?? '')
  return (
    <NodeViewWrapper as="div" className="fn-def" data-fn-def={label} contentEditable={false}>
      <span className="fn-def-label">[{label}]</span>
      <span className="fn-def-text">{text}</span>
      <a
        className="fn-back"
        title="回到引用处"
        onClick={(e) => {
          e.preventDefault()
          document
            .querySelector(`sup[data-label="${CSS.escape(label)}"]`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }}
      >
        ↩
      </a>
    </NodeViewWrapper>
  )
}

export const FootnoteRef = Node.create({
  name: 'footnoteRef',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-label') ?? '',
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-label': attrs.label }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'sup[data-footnote-ref]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { 'data-footnote-ref': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(FootnoteRefView)
  },
})

export const FootnoteDef = Node.create({
  name: 'footnoteDef',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      label: { default: '' },
      text: { default: '' },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-footnote-def]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-footnote-def': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(FootnoteDefView)
  },
})
