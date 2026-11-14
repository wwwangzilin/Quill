/**
 * 行内续写建议（VSCode 那种幽灵文本）。
 *
 * 实现方式是 ProseMirror 的一个 widget 装饰：在光标位置插一段灰色的、
 * 不可编辑的 span，正文本身一个字符都不动 —— 所以「不接受」就等于什么都没发生。
 *
 * 交互：
 *   Tab    接受（把建议文本插进文档，可撤销）
 *   Esc    忽略
 *   打字   自动作废（文档一变就清）
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'

export interface AiSuggestion {
  /** 建议插入的文本 */
  text: string
  /** 插入位置（就是光标所在的文档位置） */
  pos: number
  /** 还在等模型返回 */
  loading: boolean
  /** 出错信息（显示成灰字提示，不弹窗打断写作） */
  error: string | null
}

const EMPTY: AiSuggestion = { text: '', pos: 0, loading: false, error: null }

export const aiKey = new PluginKey<AiSuggestion>('quillAiComplete')

// dev 下把 PluginKey 也暴露出去，方便 CDP 验收脚本直接读写建议状态
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__quillAiKey = aiKey
}

export function aiState(view: EditorView): AiSuggestion | null {
  return aiKey.getState(view.state) ?? null
}

export function setAiState(view: EditorView, next: AiSuggestion): void {
  if (view.isDestroyed) return
  view.dispatch(view.state.tr.setMeta(aiKey, next))
}

export function clearAi(view: EditorView): void {
  if (view.isDestroyed) return
  const cur = aiKey.getState(view.state)
  if (!cur || (!cur.text && !cur.loading && !cur.error)) return
  view.dispatch(view.state.tr.setMeta(aiKey, { ...EMPTY, pos: cur.pos }))
}

/** 接受建议：插进文档（走正常事务，所以 Ctrl+Z 能撤销） */
export function acceptAi(view: EditorView): boolean {
  const cur = aiKey.getState(view.state)
  if (!cur?.text) return false
  const pos = Math.max(0, Math.min(cur.pos, view.state.doc.content.size))
  const tr = view.state.tr.insertText(cur.text, pos)
  tr.setMeta(aiKey, { ...EMPTY, pos })
  view.dispatch(tr)
  return true
}

export const AiComplete = Extension.create({
  name: 'quillAiComplete',
  /**
   * 必须比 Tab 缩进扩展先拿到键盘事件。
   *
   * 不设优先级的话，插件会排在 Tiptap 那一堆 keymap 后面（实测排在第 54 个
   * keydown handler 上），按 Tab 会被「缩进」先认领走 —— 表现就是：
   * 幽灵文本明明显示着，按 Tab 却变成了列表缩进。
   */
  priority: 1000,

  addProseMirrorPlugins() {
    return [
      new Plugin<AiSuggestion>({
        key: aiKey,

        state: {
          init: () => EMPTY,
          apply(tr, prev) {
            const meta = tr.getMeta(aiKey) as AiSuggestion | undefined
            if (meta) return meta
            // 文档变了（用户打字）或光标动了 → 旧建议立刻作废
            if (tr.docChanged || tr.selectionSet) return EMPTY
            return prev
          },
        },

        props: {
          decorations(state) {
            const s = aiKey.getState(state)
            if (!s || (!s.text && !s.loading && !s.error)) return null
            const pos = Math.max(0, Math.min(s.pos, state.doc.content.size))
            const widget = Decoration.widget(
              pos,
              () => {
                const span = document.createElement('span')
                span.className =
                  'quill-ai-ghost' +
                  (s.loading && !s.text ? ' is-loading' : '') +
                  (s.error ? ' is-error' : '')
                span.setAttribute('contenteditable', 'false')
                span.textContent = s.error ? s.error : s.text || '···'
                if (!s.error) span.title = 'Tab 接受 · Esc 忽略'
                return span
              },
              { side: 1, key: `ai-${s.text.length}-${s.loading ? 1 : 0}-${s.error ? 1 : 0}` },
            )
            return DecorationSet.create(state.doc, [widget])
          },

          handleKeyDown(view, event) {
            const s = aiKey.getState(view.state)
            if (typeof window !== 'undefined' && import.meta.env.DEV) {
              const w = window as unknown as Record<string, unknown>
              const log = (w.__aiPluginLog as string[]) ?? []
              log.push(`${event.key} state=${s ? JSON.stringify(s) : 'null'}`)
              w.__aiPluginLog = log
            }
            if (!s) return false
            const active = Boolean(s.text) || s.loading || Boolean(s.error)
            if (!active) return false

            if (event.key === 'Tab' && s.text) {
              event.preventDefault()
              return acceptAi(view)
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              clearAi(view)
              return true
            }
            return false
          },
        },
      }),
    ]
  },
})
