/**
 * 续写触发器：决定「什么时候该问模型」。
 *
 * 省钱的规矩（每一条都是真金白银）：
 *   · 只在你停手 delay 毫秒之后才发请求，边打字边发是不可能的
 *   · 光标前至少要有 6 个字，空段落不猜
 *   · 同一个前缀不重复请求（缓存最近一次的前缀）
 *   · 一次只要 1～2 句、max_tokens 96
 *   · 选中一段文本、输入法组词中，都不打扰
 */
import { useCallback, useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import { aiStream } from '../core/ai'
import { toast } from '../ui/toast'
import { aiState, clearAi, setAiState } from './aiComplete'

const SYSTEM = `你是中文写作的续写助手。只输出紧接着要写下去的正文本身：
- 不要解释、不要客套、不要复述已经有过的内容
- 不要输出引号、不要用 Markdown 代码围栏或标题符号
- 与上文的语言、人称、语气保持一致
- 长度控制在 1～2 句（约 40 字以内），写成能直接接上的半句话或一整句`

export function buildPrompt(title: string, before: string): string {
  return `【文档标题】${title || '未命名'}

【光标之前的正文】
${before || '（还是空的，请起个头）'}

请只续写光标处接下来的一小段。`
}

interface Options {
  editor: Editor | null
  enabled: boolean
  delay: number
  title: string
}

export function useAiComplete({ editor, enabled, delay, title }: Options) {
  const timer = useRef<number | null>(null)
  /** 每次请求发一个序号，回来时对不上就丢掉（防止旧结果盖新结果） */
  const seq = useRef(0)
  const lastKey = useRef('')

  const cancel = useCallback(() => {
    seq.current += 1
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const ask = useCallback(
    async (manual: boolean) => {
      const ed = editor
      if (!ed || ed.isDestroyed) return
      const view = ed.view
      const { state } = view
      const sel = state.selection

      if (!sel.empty) return // 选了东西说明在改，不猜
      if (view.composing) return // 输入法组词中
      const $from = state.doc.resolve(sel.from)
      if (!$from.parent.isTextblock) return

      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc')
      if (!manual && before.trim().length < 6) return

      const context = state.doc.textBetween(0, sel.from, '\n', '\ufffc').slice(-1500)
      const key = before.slice(-120)
      if (!manual && key === lastKey.current) return
      lastKey.current = key

      const pos = sel.from
      const mine = (seq.current += 1)
      setAiState(view, { text: '', pos, loading: true, error: null })

      try {
        await aiStream(
          {
            system: SYSTEM,
            prompt: buildPrompt(title, context),
            maxTokens: 96,
            temperature: 0.75,
          },
          (full) => {
            if (mine !== seq.current || view.isDestroyed) return
            setAiState(view, { text: full, pos, loading: false, error: null })
          },
        )
        if (mine === seq.current) {
          const cur = aiState(view)
          if (cur && !cur.text) clearAi(view) // 模型什么都没回，别留个省略号
        }
      } catch (err) {
        if (mine !== seq.current || view.isDestroyed) return
        clearAi(view)
        toast.error('AI 续写失败', String(err).slice(0, 180))
      }
    },
    [editor, title],
  )

  /** 停手之后排一次请求（打字过程中反复调用，只会保留最后一次） */
  const schedule = useCallback(() => {
    cancel()
    if (!enabled) {
      if (editor && !editor.isDestroyed) clearAi(editor.view)
      return
    }
    timer.current = window.setTimeout(() => {
      timer.current = null
      void ask(false)
    }, Math.max(300, delay))
  }, [cancel, enabled, delay, ask, editor])

  /** 手动要一次（Alt+/） */
  const askNow = useCallback(() => {
    cancel()
    void ask(true)
  }, [cancel, ask])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === '/') {
        e.preventDefault()
        askNow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [askNow])

  // 关掉开关时，把已经挂着的建议和定时器一起收掉
  useEffect(() => {
    if (enabled) return
    cancel()
    if (editor && !editor.isDestroyed) clearAi(editor.view)
  }, [enabled, cancel, editor])

  return { schedule, askNow, cancel }
}
