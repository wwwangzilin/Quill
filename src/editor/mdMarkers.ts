import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

export const mdMarkerKey = new PluginKey('quillMdMarkers')

/**
 * Markdown 标记提示。
 *
 * 编辑器把 `**粗体**` 变成粗体时，那两对星号就被吃掉了 —— 于是你没法确认
 * 文件里到底写的是什么。这里把标记**当装饰画回来**：淡灰色显示，看得见、
 * 但**不进文档数据**。
 *
 * 所以 `.md` 依旧干干净净：复制、导出、拿别的编辑器打开，都不会多出任何字符；
 * 关掉这个扩展，界面就回到原来的纯所见即所得。
 */

/** 行内标记 → 它在 Markdown 里的写法 */
const INLINE_TOKEN: Record<string, string> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  code: '`',
  highlight: '==',
}

function marker(text: string, side: 'open' | 'close'): HTMLElement {
  const el = document.createElement('span')
  el.className = `md-marker md-marker-${side}`
  el.textContent = text
  // 这两条是关键：装饰不可编辑、也不参与朗读
  el.contentEditable = 'false'
  el.setAttribute('aria-hidden', 'true')
  return el
}

/** 一个文本块（段落 / 标题）里的行内标记 */
function inlineMarkers(node: PMNode, base: number): Decoration[] {
  const decos: Decoration[] = []

  // 把每个字符位置的「有哪些 mark」摊平，方便找连续区间
  const cells: { pos: number; marks: Set<string> }[] = []
  node.forEach((child, offset) => {
    if (!child.isText) return
    const start = base + 1 + offset
    const names = new Set(child.marks.map((m) => m.type.name))
    for (let i = 0; i < child.nodeSize; i += 1) cells.push({ pos: start + i, marks: names })
  })
  if (!cells.length) return decos

  for (const [markName, token] of Object.entries(INLINE_TOKEN)) {
    let runStart = -1
    for (let i = 0; i <= cells.length; i += 1) {
      const has = i < cells.length && cells[i].marks.has(markName)
      if (has && runStart < 0) runStart = i
      if (!has && runStart >= 0) {
        decos.push(
          Decoration.widget(cells[runStart].pos, () => marker(token, 'open'), { side: -1 }),
        )
        decos.push(Decoration.widget(cells[i - 1].pos + 1, () => marker(token, 'close'), { side: 1 }))
        runStart = -1
      }
    }
  }

  return decos
}

/** 链接单独扫一遍：它要拿到 href，比其它 mark 多一步 */
function linkMarkers(node: PMNode, base: number): Decoration[] {
  const decos: Decoration[] = []
  let runStart = -1
  let runEnd = -1
  let href = ''

  const flush = () => {
    if (runStart < 0) return
    const short = href.length > 24 ? href.slice(0, 22) + '…' : href
    decos.push(Decoration.widget(runStart, () => marker('[', 'open'), { side: -1 }))
    decos.push(Decoration.widget(runEnd, () => marker(`](${short})`, 'close'), { side: 1 }))
    runStart = -1
    runEnd = -1
    href = ''
  }

  node.forEach((child, offset) => {
    if (!child.isText) {
      flush()
      return
    }
    const start = base + 1 + offset
    const link = child.marks.find((m) => m.type.name === 'link')
    if (!link) {
      flush()
      return
    }
    if (runStart < 0) {
      runStart = start
      href = String(link.attrs.href ?? '')
    }
    runEnd = start + child.nodeSize
  })
  flush()
  return decos
}

function build(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []

  doc.descendants((node, pos) => {
    // 代码块里的内容是字面文本，不该再标什么
    if (node.type.name === 'codeBlock') {
      const lang = String(node.attrs?.language ?? '')
      decos.push(
        Decoration.widget(pos + 1, () => marker('```' + lang, 'open'), { side: -1 }),
      )
      return false
    }

    if (node.type.name === 'heading') {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)))
      decos.push(Decoration.widget(pos + 1, () => marker('#'.repeat(level) + ' ', 'open'), { side: -1 }))
    }

    if (node.type.name === 'blockquote') {
      decos.push(Decoration.widget(pos + 1, () => marker('> ', 'open'), { side: -1 }))
    }

    if (node.isTextblock) {
      decos.push(...inlineMarkers(node, pos))
      decos.push(...linkMarkers(node, pos))
      return false
    }
    return true
  })

  // taskItem 的方框、列表的圆点、表格线、分隔线都已经有原生视觉，
  // 再叠一层 `- ` / `|` 只会糊成一片，所以那些不标。

  return DecorationSet.create(doc, decos)
}

export const MdMarkers = Extension.create({
  name: 'quillMdMarkers',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: mdMarkerKey,
        props: {
          decorations(state) {
            return build(state.doc)
          },
        },
      }),
    ]
  },
})
