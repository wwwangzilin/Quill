import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * 块拖拽排序。
 *
 * 做法是给每个可拖块（顶层块 + 列表项）插一个装饰器手柄，
 * 用原生 HTML5 拖放 + ProseMirror 事务完成移动；
 * 拖拽过程中按鼠标位置吸附到最近的块边界，并画一条落点指示线。
 */
export const DragSort = Extension.create({
  name: 'quillDragSort',

  addProseMirrorPlugins() {
    const editor = this.editor
    let dragging: { pos: number; node: PMNode } | null = null
    let dropAt: number | null = null
    let line: HTMLElement | null = null

    const hostOf = (view: EditorView): HTMLElement =>
      (view.dom.parentElement as HTMLElement) ?? view.dom

    const lineEl = (view: EditorView): HTMLElement => {
      if (!line) {
        line = document.createElement('div')
        line.className = 'drag-line'
        hostOf(view).appendChild(line)
      }
      return line
    }

    const hideLine = () => {
      if (line) line.style.display = 'none'
    }

    const reset = () => {
      dragging = null
      dropAt = null
      hideLine()
    }

    /** 鼠标位置 → 最近的可拖块边界 */
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

    const handle = (pos: number) =>
      Decoration.widget(
        pos + 1,
        () => {
          const el = document.createElement('span')
          el.className = 'drag-handle'
          el.setAttribute('contenteditable', 'false')
          el.setAttribute('draggable', 'true')
          el.dataset.pos = String(pos)
          el.title = '拖动排序'
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
            state.doc.forEach((node, offset) => {
              decos.push(handle(offset))
            })
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
                decos.push(handle(pos))
              }
            })
            return decos.length ? DecorationSet.create(state.doc, decos) : null
          },

          handleDOMEvents: {
            dragstart: (view, event) => {
              const target = event.target as HTMLElement | null
              if (!target?.classList?.contains('drag-handle')) return false
              const pos = Number(target.dataset.pos)
              const node = view.state.doc.nodeAt(pos)
              if (!node) return false
              dragging = { pos, node }
              dropAt = null
              target.classList.add('dragging')
              const dt = (event as DragEvent).dataTransfer
              if (dt) {
                dt.effectAllowed = 'move'
                dt.setData('text/plain', '')
                const dom = view.nodeDOM(pos) as HTMLElement | null
                if (dom) dt.setDragImage(dom, 12, 12)
              }
              return true
            },

            dragover: (view, event) => {
              if (!dragging) return false
              event.preventDefault()
              const hit = nearestBlock(view, event.clientX, event.clientY)
              if (!hit) return true
              const dom = view.nodeDOM(hit.pos) as HTMLElement | null
              if (!dom) return true
              const rect = dom.getBoundingClientRect()
              const after = event.clientY > rect.top + rect.height / 2
              dropAt = after ? hit.pos + hit.node.nodeSize : hit.pos

              const host = hostOf(view)
              const hostRect = host.getBoundingClientRect()
              const l = lineEl(view)
              l.style.display = 'block'
              l.style.left = `${rect.left - hostRect.left}px`
              l.style.width = `${rect.width}px`
              l.style.top = `${(after ? rect.bottom : rect.top) - hostRect.top - 1}px`
              return true
            },

            drop: (view, event) => {
              if (!dragging || dropAt == null) {
                reset()
                return false
              }
              event.preventDefault()
              const { pos, node } = dragging
              const to = dropAt
              reset()
              // 落在自己身上 = 什么都不做
              if (to >= pos && to <= pos + node.nodeSize) return true
              const tr = view.state.tr
              tr.delete(pos, pos + node.nodeSize)
              const mapped = tr.mapping.map(to, -1)
              tr.insert(mapped, node)
              view.dispatch(tr.scrollIntoView())
              editor.commands.focus()
              return true
            },

            dragend: () => {
              document
                .querySelectorAll('.ProseMirror .drag-handle.dragging')
                .forEach((el) => el.classList.remove('dragging'))
              reset()
              return false
            },
          },
        },
      }),
    ]
  },
})
