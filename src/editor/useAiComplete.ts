/**
 * 续写触发器：决定「什么时候该问模型」。
 *
 * 省钱的规矩（每一条都是真金白银）：
 *   · 只在你停手 delay 毫秒之后才发请求，边打字边发是不可能的
 *   · 光标前至少要有 6 个字，空段落不猜
 *   · 同一个前缀不重复请求（缓存最近一次的前缀）
 *   · 一次只要 1～2 句（上限可在设置里调，默认 160 tokens）
 *   · 选中一段文本、输入法组词中，都不打扰
 */
import { useCallback, useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import { aiStream } from '../core/ai'
import { readAiTuning, withStyle } from '../core/aiPrefs'
import { toast } from '../ui/toast'
import { aiState, clearAi, setAiState } from './aiComplete'

const SYSTEM = `你是中文写作的续写助手。只输出紧接着要写下去的正文本身：
- 不要解释、不要客套、不要复述上文已经写过的话
- 不要用引号、Markdown 标题符号或代码围栏，也不要写「……」「（未完待续）」这类占位
- 与上文的语言、人称、语气、节奏保持一致
- 从光标处直接接下去，不要重复光标前最后那几个字
- 只写一小段（一两句），不要铺陈成长段`

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

      const tuning = readAiTuning()
      try {
        await aiStream(
          {
            system: withStyle(SYSTEM, tuning),
            prompt: buildPrompt(title, context),
            maxTokens: tuning.continueTokens,
            temperature: tuning.temperature,
          },
          (full) => {
            if (mine !== seq.current || view.isDestroyed) return
            setAiState(view, { text: full, pos, loading: false, error: null })
          },
          (info) => {
            // 撞上长度上限说明模型还有话要说。提示本身留着当参考，
            // 但得讲清楚它为什么断在半句，否则只会让人以为 AI 坏了
            if (mine !== seq.current || !info.truncated) return
            toast.info('续写到了长度上限', '可在设置 · AI 助手里调高「续写长度」')
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
