import { Extension } from '@tiptap/core'
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
import { TableKit } from '@tiptap/extension-table'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'

/** 代码块语法高亮的语言包：常用语言全都有，纯前端、不加其它依赖 */
const lowlight = createLowlight(common)
import Image from '@tiptap/extension-image'
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
    Image.configure({ inline: false, allowBase64: false }),
    Video,
  ]
}
