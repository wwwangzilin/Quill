import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * 块拖拽排序。
 *
 * 刻意**不用 HTML5 原生拖放**：编辑器是 contenteditable，浏览器会把子元素的
 * draggable 拦掉（光标变成「禁止」，根本拖不动）。这里改成 pointer 事件自己算：
 * 按下手柄 → 跟随鼠标找最近的块边界 → 画落点线 → 松手用事务移动。
 */
export const DragSort = Extension.create({
  name: 'quillDragSort',

  addProseMirrorPlugins() {
    const editor = this.editor
    let line: HTMLElement | null = null
    let dragging: { pos: number; node: PMNode } | null = null
    let dropAt: number | null = null

    // 落点线挂在 body 上、用 fixed 定位。
    // 以前挂在编辑器容器里用 absolute，而那个容器没有 position: relative，
    // 一个很小的 top 会被解释成相对更外层容器，线就飘到屏幕很上面 —— 看不出要落到哪。
    const lineEl = (): HTMLElement => {
      if (!line) {
        line = document.createElement('div')
        line.className = 'drag-line'
        document.body.appendChild(line)
      }
      return line
    }

    const hideLine = () => {
      if (line) line.style.display = 'none'
    }

    /** 鼠标位置 → 最近的块（优先最深的列表项，否则顶层块） */
    const nearestBlock = (view: EditorView, clientX: number, clientY: number) => {
      const hit = view.posAtCoords({ left: clientX, top: clientY })
      if (!hit) return null
      const doc = view.state.doc
      const $pos = doc.resolve(Math.max(0, Math.min(hit.pos, doc.content.size)))

      for (let d = $pos.depth; d > 0; d -= 1) {
        const node = $pos.node(d)
        if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
          return { pos: $pos.before(d), node }
        }
      }
      const idx = Math.min($pos.index(0), Math.max(doc.childCount - 1, 0))
      let start = 0
      for (let i = 0; i < idx; i += 1) start += doc.child(i).nodeSize
      return { pos: start, node: doc.child(idx) }
    }

    const startDrag = (view: EditorView, handle: HTMLElement, ev: PointerEvent) => {
      const pos = Number(handle.dataset.pos)
      const node = view.state.doc.nodeAt(pos)
      if (!node || Number.isNaN(pos)) return

      dragging = { pos, node }
      dropAt = null
      handle.classList.add('dragging')
      document.body.classList.add('quill-dragging')
      ev.preventDefault()

      const onMove = (e: PointerEvent) => {
        if (!dragging) return
        const hit = nearestBlock(view, e.clientX, e.clientY)
        if (!hit) return
        const dom = view.nodeDOM(hit.pos) as HTMLElement | null
        if (!dom) return
        const rect = dom.getBoundingClientRect()
        const after = e.clientY > rect.top + rect.height / 2
        dropAt = after ? hit.pos + hit.node.nodeSize : hit.pos

        // 视口坐标直接给 fixed 元素用，不必再减任何容器的偏移
        const l = lineEl()
        l.style.display = 'block'
        l.style.left = `${rect.left}px`
        l.style.width = `${rect.width}px`
        l.style.top = `${(after ? rect.bottom : rect.top) - 1}px`
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        document.body.classList.remove('quill-dragging')
        handle.classList.remove('dragging')
        hideLine()

        const from = dragging
        const to = dropAt
        dragging = null
        dropAt = null
        if (!from || to == null) return
        // 落在自己身上 = 什么都不做
        if (to >= from.pos && to <= from.pos + from.node.nodeSize) return

        const tr = view.state.tr
        tr.delete(from.pos, from.pos + from.node.nodeSize)
        const mapped = tr.mapping.map(to, -1)
        tr.insert(mapped, from.node)
        view.dispatch(tr.scrollIntoView())
        editor.commands.focus()
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    }

    /** 手柄做成 2×3 的点阵，用真实元素而不是背景图 */
    const handleWidget = (pos: number) =>
      Decoration.widget(
        pos + 1,
        () => {
          const el = document.createElement('span')
          el.className = 'drag-handle'
          el.setAttribute('contenteditable', 'false')
          el.dataset.pos = String(pos)
          el.title = '按住拖动排序'
          for (let i = 0; i < 6; i += 1) el.appendChild(document.createElement('i'))
          return el
        },
        { side: -1, key: `dh-${pos}` },
      )

    return [
      new Plugin({
        key: new PluginKey('quillDragSort'),
        props: {
          decorations(state) {
            const decos: Decoration[] = []
            state.doc.forEach((_, offset) => {
              decos.push(handleWidget(offset))
            })
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
                decos.push(handleWidget(pos))
              }
            })
            return decos.length ? DecorationSet.create(state.doc, decos) : null
          },
          handleDOMEvents: {
            pointerdown: (view, event) => {
              const target = event.target as HTMLElement | null
              if (!target?.classList?.contains('drag-handle')) return false
              startDrag(view, target, event as PointerEvent)
              return true
            },
          },
        },
      }),
    ]
  },
})
