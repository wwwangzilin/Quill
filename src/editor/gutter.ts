import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

/** 每个顶层块在右侧显示的类型标记 */
function labelOf(node: PMNode): string {
  switch (node.type.name) {
    case 'heading':
      return `H${node.attrs.level ?? 1}`
    case 'bulletList':
      return 'UL'
    case 'orderedList':
      return 'OL'
    case 'taskList':
      return 'TODO'
    case 'blockquote':
      return 'QUOTE'
    case 'codeBlock':
      return 'CODE'
    case 'horizontalRule':
      return 'HR'
    case 'image':
      return 'IMG'
    case 'video':
      return 'VIDEO'
    case 'paragraph':
      return 'P'
    default:
      return ''
  }
}

/**
 * 右侧行标记。纯装饰，不进文档数据 —— 导出 Markdown 时不会多出任何东西。
 */
export const BlockGutter = Extension.create({
  name: 'quillBlockGutter',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('quillBlockGutter'),
        props: {
          decorations(state) {
            const decos: Decoration[] = []
            state.doc.forEach((node, offset) => {
              const label = labelOf(node)
              if (!label) return
              decos.push(
                Decoration.widget(
                  offset + 1,
                  () => {
                    const el = document.createElement('span')
                    el.className = 'gutter-label'
                    el.setAttribute('contenteditable', 'false')
                    el.textContent = label
                    return el
                  },
                  { side: -1, key: `gutter-${offset}-${label}` },
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
