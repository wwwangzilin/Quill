import { Extension, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { DragSort } from './drag'
import { SearchHighlight } from './search'
import { WikiLink } from './wikilink'
import { BlockGutter } from './gutter'
import { Video } from './media'
import { AiComplete } from './aiComplete'
import { CommentMarks } from './commentMark'
import { TableKit } from '@tiptap/extension-table'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'

/** 代码块语法高亮的语言包：常用语言全都有，纯前端、不加其它依赖 */
const lowlight = createLowlight(common)
import Image from '@tiptap/extension-image'
import { assetUrl } from '../core/asset'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'

/**
 * Tab 缩进 / Shift-Tab 反缩进 —— 大纲编辑器的手感命脉。
 * 段落里按 Tab 直接转成列表（Effie 那种「想到哪写到哪」的顺滑感）。
 */
export const TabIndent = Extension.create({
  name: 'tabIndent',
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { editor } = this
        if (editor.isActive('taskItem')) return editor.chain().sinkListItem('taskItem').run()
        if (editor.isActive('listItem')) return editor.chain().sinkListItem('listItem').run()
        if (editor.isActive('paragraph')) return editor.chain().toggleBulletList().run()
        return false
      },
      'Shift-Tab': () => {
        const { editor } = this
        if (editor.isActive('taskItem')) return editor.chain().liftListItem('taskItem').run()
        if (editor.isActive('listItem')) return editor.chain().liftListItem('listItem').run()
        return false
      },
    }
  },
})

/* ------------------------------ 大纲折叠 ------------------------------ */

export const foldKey = new PluginKey<Set<number>>('quillFold')

/**
 * 折叠状态用「节点位置集合」存，并随事务做位置映射，
 * 这样在上方编辑时折叠不会错位。
 */
export const Foldable = Extension.create({
  name: 'quillFoldable',
  addProseMirrorPlugins() {
    const editor = this.editor
    const toggle = (view: EditorView, pos: number) => {
      view.dispatch(view.state.tr.setMeta(foldKey, { pos }))
    }

    return [
      new Plugin<Set<number>>({
        key: foldKey,
        state: {
          init: () => new Set<number>(),
          apply(tr, prev) {
            const next = new Set<number>()
            for (const pos of prev) {
              const mapped = tr.mapping.mapResult(pos, -1)
              if (!mapped.deleted) next.add(mapped.pos)
            }
            const meta = tr.getMeta(foldKey) as { pos: number } | undefined
            if (meta) {
              if (next.has(meta.pos)) next.delete(meta.pos)
              else next.add(meta.pos)
            }
            return next
          },
        },
        props: {
          decorations(state) {
            const folded = foldKey.getState(state)
            const decos: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'listItem' && node.type.name !== 'taskItem') return
              if (node.childCount < 2) return // 没有子列表就没什么可折的
              const isFolded = folded?.has(pos) ?? false
              if (isFolded) {
                decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'is-folded' }))
              }
              decos.push(
                Decoration.widget(
                  pos + 1,
                  () => {
                    const btn = document.createElement('span')
                    btn.className = `fold-toggle${isFolded ? ' folded' : ''}`
                    btn.setAttribute('contenteditable', 'false')
                    btn.title = isFolded ? '展开' : '折叠'
                    btn.addEventListener('mousedown', (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      toggle(editor.view, pos)
                    })
                    return btn
                  },
                  { side: -1, key: `fold-${pos}-${isFolded ? 1 : 0}` },
                ),
              )
            })
            return decos.length ? DecorationSet.create(state.doc, decos) : null
          },
        },
      }),
    ]
  },
})

/* ------------------------------ 专注模式 ------------------------------ */

const focusKey = new PluginKey('quillFocusDim')

/** 只让光标所在的顶层块保持清晰，其余淡出 */
export const FocusDim = Extension.create({
  name: 'quillFocusDim',
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: focusKey,
        props: {
          decorations(state) {
            if (!editor.view.dom.classList.contains('focus-mode')) return null
            const pos = Math.min(state.selection.from, state.doc.content.size)
            let index: number
            try {
              index = state.doc.resolve(pos).index(0)
            } catch {
              return null
            }
            if (index < 0 || index >= state.doc.childCount) return null
            let start = 0
            for (let i = 0; i < index; i += 1) start += state.doc.child(i).nodeSize
            const node = state.doc.child(index)
            return DecorationSet.create(state.doc, [
              Decoration.node(start, start + node.nodeSize, { class: 'is-focus' }),
            ])
          },
        },
      }),
    ]
  },
})

/**
 * 图片。
 *
 * 文档里存的永远是仓库相对路径（`assets/xxx.png`），但 WebView 直接渲染它
 * 会当成 `http://localhost/assets/xxx.png` 去取 —— 404，最后只剩一行 alt 文字。
 * 所以渲染这一层必须换成 Tauri 的 asset:// URL。
 *
 * 只在 renderHTML 里转、不动数据：编辑器 JSON 与 Markdown 导出拿到的
 * 依旧是干净的相对路径，换机器 / 别的编辑器 / 远程备份都不受影响。
 *
 * 另外挂了 width 属性和一个右下角拖拽手柄：调过尺寸的图在 .md 里会写成
 * `<img ... width="400">`（Markdown 语法本身表达不了宽度）。
 */
const AssetImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const w = Number(el.getAttribute('width'))
          return Number.isFinite(w) && w > 0 ? Math.round(w) : null
        },
        renderHTML: (attrs) => (attrs.width ? { width: String(attrs.width) } : {}),
      },
    }
  },

  addNodeView() {
    return ({ node: initial, editor, getPos }) => {
      let node = initial

      const wrap = document.createElement('div')
      wrap.className = 'img-wrap'
      const img = document.createElement('img')
      img.alt = String(node.attrs.alt ?? '')
      img.src = assetUrl(String(node.attrs.src ?? ''))
      if (node.attrs.width) img.style.width = `${node.attrs.width}px`

      const handle = document.createElement('span')
      handle.className = 'img-resize'
      handle.setAttribute('contenteditable', 'false')
      handle.title = '拖动改宽度 · 双击恢复自适应'
      const badge = document.createElement('span')
      badge.className = 'img-size'
      badge.setAttribute('contenteditable', 'false')

      wrap.append(img, badge, handle)

      const commit = (w: number | null) => {
        const pos = typeof getPos === 'function' ? getPos() : undefined
        if (typeof pos !== 'number') return
        const tr = editor.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, width: w })
        editor.view.dispatch(tr)
      }

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const startX = e.clientX
        const startW = img.getBoundingClientRect().width
        // 最宽不超过正文栏，最窄留个 60px 免得拖成一条线
        const maxW = wrap.parentElement?.clientWidth ?? 720
        const clamp = (x: number) => Math.round(Math.min(maxW, Math.max(60, x)))
        wrap.classList.add('dragging')
        badge.textContent = `${Math.round(startW)}px`

        const onMove = (ev: MouseEvent) => {
          const next = clamp(startW + (ev.clientX - startX))
          img.style.width = `${next}px`
          badge.textContent = `${next}px`
        }
        const onUp = (ev: MouseEvent) => {
          document.removeEventListener('mousemove', onMove, true)
          document.removeEventListener('mouseup', onUp, true)
          wrap.classList.remove('dragging')
          handle.classList.remove('on')
          const next = clamp(startW + (ev.clientX - startX))
          img.style.width = `${next}px`
          commit(next)
        }
        handle.classList.add('on')
        document.addEventListener('mousemove', onMove, true)
        document.addEventListener('mouseup', onUp, true)
      })

      // 双击手柄 = 恢复自适应宽度（回到标准 ![](src) 写法）
      handle.addEventListener('dblclick', (e) => {
        e.preventDefault()
        e.stopPropagation()
        img.style.width = ''
        commit(null)
      })

      return {
        dom: wrap,
        update(updated) {
          if (updated.type.name !== 'image') return false
          node = updated
          const next = assetUrl(String(updated.attrs.src ?? ''))
          if (img.getAttribute('src') !== next) img.setAttribute('src', next)
          img.alt = String(updated.attrs.alt ?? '')
          if (updated.attrs.width) img.style.width = `${updated.attrs.width}px`
          else img.style.width = ''
          return true
        },
        selectNode() {
          wrap.classList.add('selected')
        },
        deselectNode() {
          wrap.classList.remove('selected')
        },
        // 手柄上的鼠标事件别交给 ProseMirror，否则会变成拖拽选文字
        stopEvent: (event: Event) => event.target === handle,
        // 我们自己改的 style / class 不算文档变更，别让 ProseMirror 重新解析
        ignoreMutation: () => true,
      }
    }
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'img',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        src: assetUrl(String(HTMLAttributes.src ?? '')),
      }),
    ]
  },
})

export function buildExtensions(placeholder: string) {
  return [
    // 放最前面：Tab 要优先被「接受续写建议」截走，没建议时才轮到缩进
    AiComplete,
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // 用带语法高亮的代码块替换掉自带的
      codeBlock: false,
    }),
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    // GFM 表格：写进 .md 就是标准的 | a | b | 语法，别的编辑器照样认
    TableKit.configure({ table: { resizable: false } }),
    Placeholder.configure({ placeholder }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight,
    TabIndent,
    Foldable,
    FocusDim,
    DragSort,
    SearchHighlight,
    WikiLink,
    BlockGutter,
    AssetImage.configure({ inline: false, allowBase64: false }),
    Video,
    // 批注底纹：纯 decoration，不进文档数据
    CommentMarks,
  ]
}
