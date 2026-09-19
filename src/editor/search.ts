import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Editor } from '@tiptap/core'

export const searchKey = new PluginKey('quillSearch')

interface SearchStorage {
  query: string
  active: number
}

declare module '@tiptap/core' {
  interface Storage {
    quillSearchHighlight: SearchStorage
  }
}

/**
 * 查找高亮。
 * 查询词放在扩展的 storage 里，改完手动 dispatch 一个空事务即可刷新，
 * 不必为每次输入重建扩展。
 */
export const SearchHighlight = Extension.create({
  name: 'quillSearchHighlight',

  addStorage(): SearchStorage {
    return { query: '', active: 0 }
  },

  addProseMirrorPlugins() {
    const ext = this
    return [
      new Plugin({
        key: searchKey,
        props: {
          decorations(state) {
            const { query, active } = ext.storage as SearchStorage
            if (!query) return null
            const q = query.toLowerCase()
            const decos: Decoration[] = []
            let n = 0
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              const lower = node.text.toLowerCase()
              let idx = lower.indexOf(q)
              while (idx >= 0) {
                decos.push(
                  Decoration.inline(pos + idx, pos + idx + query.length, {
                    class: n === active ? 'search-hit active' : 'search-hit',
                  }),
                )
                n += 1
                idx = lower.indexOf(q, idx + q.length)
              }
            })
            return decos.length ? DecorationSet.create(state.doc, decos) : null
          },
        },
      }),
    ]
  },
})

/** 统计匹配数，并给出每个匹配的位置（从上往下） */
export function scanMatches(editor: Editor, query: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  const q = query.toLowerCase()
  if (!q) return out
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const lower = node.text.toLowerCase()
    let idx = lower.indexOf(q)
    while (idx >= 0) {
      out.push({ from: pos + idx, to: pos + idx + query.length })
      idx = lower.indexOf(q, idx + q.length)
    }
  })
  return out
}

/** 刷新高亮（改完 storage 后调用） */
export function refreshSearch(editor: Editor, query: string, active: number) {
  const s = editor.storage.quillSearchHighlight as SearchStorage
  s.query = query
  s.active = active
  editor.view.dispatch(editor.state.tr)
}

/** 全部替换：从后往前改，避免位置偏移 */
export function replaceAll(editor: Editor, query: string, replacement: string): number {
  const hits = scanMatches(editor, query)
  if (!hits.length) return 0
  const tr = editor.state.tr
  for (let i = hits.length - 1; i >= 0; i -= 1) {
    tr.insertText(replacement, hits[i].from, hits[i].to)
  }
  editor.view.dispatch(tr)
  return hits.length
}
