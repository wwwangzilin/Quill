import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { locate, type Comment } from '../core/comments'

export const commentKey = new PluginKey<Comment[]>('quillComments')

/**
 * 点正文里的批注底纹时回调。
 * 走模块级注册而不是 props：编辑器只在挂载时构建一次扩展，
 * 一层层传回调会拿到过期闭包。
 */
let pickHandler: ((id: string) => void) | null = null

export function onCommentPick(fn: ((id: string) => void) | null): void {
  pickHandler = fn
}

/**
 * 批注底纹。
 *
 * 只画 ProseMirror 装饰 —— 不进文档数据，所以 `.md` 永远干干净净：
 * 导出、复制富文本、拿别的编辑器打开，都看不到任何批注痕迹。
 */
export const CommentMarks = Extension.create({
  name: 'quillCommentMarks',

  addProseMirrorPlugins() {
    return [
      new Plugin<Comment[]>({
        key: commentKey,
        state: {
          init: () => [],
          apply(tr, prev) {
            const meta = tr.getMeta(commentKey) as Comment[] | undefined
            return meta ?? prev
          },
        },
        props: {
          decorations(state) {
            const list = commentKey.getState(state) ?? []
            if (!list.length) return null
            const decos: Decoration[] = []
            for (const c of list) {
              const at = locate(state.doc, c.quote)
              if (!at) continue // 原文被改没了，正文就不标了（列表里会提示）
              decos.push(
                Decoration.inline(at.from, at.to, {
                  class: `has-comment${c.resolved ? ' is-resolved' : ''}`,
                  'data-comment': c.id,
                  title: c.note.slice(0, 120),
                }),
              )
            }
            return decos.length ? DecorationSet.create(state.doc, decos) : null
          },
          handleClick(_view, _pos, event) {
            const el = (event.target as HTMLElement)?.closest?.('.has-comment')
            const id = el?.getAttribute('data-comment')
            if (id && pickHandler) {
              pickHandler(id)
              return true
            }
            return false
          },
        },
      }),
    ]
  },
})

/**
 * 把批注列表灌给编辑器。
 * `addToHistory: false` —— 批注的新增/删除不该占掉用户的 Ctrl+Z。
 */
export function applyComments(editor: Editor, list: Comment[]): void {
  if (editor.isDestroyed) return
  const tr = editor.state.tr.setMeta(commentKey, list).setMeta('addToHistory', false)
  editor.view.dispatch(tr)
}
