import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { aiStream } from '../core/ai'
import { readAiTuning, withStyle } from '../core/aiPrefs'
import { toast } from './toast'

interface Props {
  open: boolean
  title: string
  content: JSONContent | null
  onClose: () => void
  /** 把回答插到正文末尾 */
  onInsert: (text: string) => void
}

/** 从编辑器 JSON 里摊出纯文本（发给模型用） */
function plainText(node: JSONContent | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  const inner = (node.content ?? []).map(plainText).join('')
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return `${inner}\n`
    case 'listItem':
    case 'taskItem':
      return `- ${inner}\n`
    case 'blockquote':
      return `> ${inner}\n`
    case 'codeBlock':
      return `${inner}\n`
    default:
      return inner
  }
}

const QUICK = [
  { label: '这篇讲了什么', prompt: '用三五句话概括这篇文档的主要内容。' },
  { label: '帮我挑毛病', prompt: '指出这篇文档在结构、逻辑或表达上最值得改的三个问题，每条一句话。' },
  { label: '提取大纲', prompt: '把这篇文档整理成一份层级清晰的 Markdown 大纲，只列要点。' },
  { label: '起个标题', prompt: '给这篇文档起 5 个更贴切的标题，每行一个，不要解释。' },
]

const SYSTEM = `你是写作助手，读的是用户自己写的文档：
- 只依据文档内容作答；文档里没有提到的，就直接说没有提到，不要编造
- 用中文，回答简洁；要点多的时候用短列表，不要写成长篇大论
- 引用原文只摘关键短语，不要大段复述`

/** 全文问答：把整篇丢给模型，问什么答什么，答案可以一键插回文末 */
export default function AiChatPanel({ open, title, content, onClose, onInsert }: Props) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  /** 回答撞上长度上限被砍断了 */
  const [cut, setCut] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuestion('')
    setAnswer('')
    setCut(false)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [open])

  // 流式输出时让答案区跟着滚
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [answer])

  const ask = useCallback(
    async (q: string) => {
      const text = plainText(content ?? undefined).slice(0, 6000)
      if (!text.trim()) {
        toast.info('这篇还是空的', '没什么可问的')
        return
      }
      setBusy(true)
      setAnswer('')
      setCut(false)
      const tuning = readAiTuning()
      try {
        await aiStream(
          {
            system: withStyle(SYSTEM, tuning),
            prompt: `【文档标题】${title || '未命名'}\n\n【文档正文】\n${text}\n\n【问题】${q}`,
            maxTokens: tuning.answerTokens,
            temperature: tuning.temperature,
          },
          (full) => setAnswer(full),
          (info) => setCut(info.truncated),
        )
      } catch (err) {
        setAnswer('')
        toast.error('提问失败', String(err).slice(0, 160))
      } finally {
        setBusy(false)
      }
    },
    [content, title],
  )

  if (!open) return null

  return (
    <div className="aichat">
      <div className="aichat-head">
        <span className="aichat-title">问这篇文档</span>
        <span className="grow" />
        <button className="btn ghost icon" onClick={onClose} title="关闭 · Esc">
          ×
        </button>
      </div>

      <div className="aichat-body" ref={bodyRef}>
        {!answer && !busy && (
          <div className="aichat-quick">
            {QUICK.map((q) => (
              <button
                key={q.label}
                className="aichat-chip"
                onClick={() => {
                  setQuestion(q.label)
                  void ask(q.prompt)
                }}
              >
                {q.label}
              </button>
            ))}
          </div>
        )}
        {busy && !answer && <div className="aichat-wait">正在读这篇文档…</div>}
        {answer && <div className="aichat-answer">{answer}</div>}
        {cut && !busy && (
          <div className="ai-trunc">
            回答可能没写完 · 已到长度上限，可在设置 · AI 助手中调高「回答长度」
          </div>
        )}
      </div>

      {answer && !busy && (
        <div className="aichat-actions">
          <button className="btn" onClick={() => onInsert(answer)}>
            插到文末
          </button>
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard.writeText(answer)
              toast.success('已复制')
            }}
          >
            复制
          </button>
          <span className="grow" />
          <button className="btn ghost" onClick={() => setAnswer('')}>
            清空
          </button>
        </div>
      )}

      <div className="aichat-foot">
        <input
          ref={inputRef}
          className="aichat-input"
          value={question}
          placeholder="问点什么…… 回车发送"
          spellCheck={false}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
              return
            }
            if (e.key === 'Enter' && question.trim() && !busy) {
              e.preventDefault()
              void ask(question.trim())
            }
          }}
        />
        <button
          className="btn primary"
          disabled={busy || !question.trim()}
          onClick={() => void ask(question.trim())}
        >
          {busy ? '…' : '问'}
        </button>
      </div>
    </div>
  )
}
