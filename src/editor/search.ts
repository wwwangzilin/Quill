import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Editor } from '@tiptap/core'
import { expandReplacement, FIND_DEFAULTS, findInText, type FindOpts } from '../core/findMatch'

export const searchKey = new PluginKey('quillSearch')

interface SearchStorage {
  query: string
  active: number
  opts: FindOpts
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
    return { query: '', active: 0, opts: { ...FIND_DEFAULTS } }
  },

  addProseMirrorPlugins() {
    const ext = this
    return [
      new Plugin({
        key: searchKey,
        props: {
          decorations(state) {
            const { query, active, opts } = ext.storage as SearchStorage
            if (!query) return null
            const decos: Decoration[] = []
            let n = 0
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              for (const h of findInText(node.text, query, opts)) {
                decos.push(
                  Decoration.inline(pos + h.start, pos + h.end, {
                    class: n === active ? 'search-hit active' : 'search-hit',
                  }),
                )
                n += 1
              }
            })
            return decos.length ? DecorationSet.create(state.doc, decos) : null
          },
        },
      }),
    ]
  },
})

export interface Hit {
  from: number
  to: number
  text: string
}

/** 统计匹配数，并给出每个匹配的位置（从上往下） */
export function scanMatches(editor: Editor, query: string, opts: FindOpts = FIND_DEFAULTS): Hit[] {
  const out: Hit[] = []
  if (!query) return out
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    for (const h of findInText(node.text, query, opts)) {
      out.push({ from: pos + h.start, to: pos + h.end, text: h.text })
    }
  })
  return out
}

/** 刷新高亮（改完 storage 后调用） */
export function refreshSearch(editor: Editor, query: string, active: number, opts: FindOpts = FIND_DEFAULTS) {
  const s = editor.storage.quillSearchHighlight as SearchStorage
  s.query = query
  s.active = active
  s.opts = opts
  editor.view.dispatch(editor.state.tr)
}

/** 某个命中该替换成什么（正则模式下展开 $1） */
export function replacementFor(hit: Hit, query: string, replacement: string, opts: FindOpts): string {
  return expandReplacement({ start: 0, end: hit.to - hit.from, text: hit.text }, query, replacement, opts)
}

/** 全部替换：从后往前改，避免位置偏移 */
export function replaceAll(
  editor: Editor,
  query: string,
  replacement: string,
  opts: FindOpts = FIND_DEFAULTS,
): number {
  const hits = scanMatches(editor, query, opts)
  if (!hits.length) return 0
  const tr = editor.state.tr
  for (let i = hits.length - 1; i >= 0; i -= 1) {
    tr.insertText(replacementFor(hits[i], query, replacement, opts), hits[i].from, hits[i].to)
  }
  editor.view.dispatch(tr)
  return hits.length
}
