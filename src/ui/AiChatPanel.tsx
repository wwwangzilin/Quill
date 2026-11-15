import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { aiStream } from '../core/ai'
import { readAiTuning, withStyle } from '../core/aiPrefs'
import { storage, type ContextChunk } from '../core/storage'
import { toast } from './toast'

interface Props {
  open: boolean
  title: string
  content: JSONContent | null
  onClose: () => void
  /** 把回答插到正文末尾 */
  onInsert: (text: string) => void
  /** 文件模式：可以问整个知识库 */
  vaultMode?: boolean
  /** 点出处：打开那篇文档并落到那一处 */
  onOpenSource?: (file: string, needle: string) => void
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

/** 全库问答的系统提示词：只认材料、必须标出处、没有就说没有 */
const VAULT_SYSTEM = `你在一名作者自己的知识库里检索并回答问题。
- 只能依据【知识库检索结果】作答；材料里没有的，直接说「知识库里没找到」，不要用常识补
- 每个要点后面用 [1] [2] 标注它来自哪条材料，编号必须是给出的那些
- 用中文，简洁；能用一两句说清就别写一段
- 引用原文只摘关键短语`

/** 全文问答：把整篇丢给模型，问什么答什么，答案可以一键插回文末 */
export default function AiChatPanel({
  open,
  title,
  content,
  onClose,
  onInsert,
  vaultMode,
  onOpenSource,
}: Props) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  /** 回答撞上长度上限被砍断了 */
  const [cut, setCut] = useState(false)
  const [busy, setBusy] = useState(false)
  /** 问一篇 / 问全库 */
  const [scope, setScope] = useState<'doc' | 'vault'>('doc')
  /** 这次回答依据的材料（点了能跳过去） */
  const [sources, setSources] = useState<ContextChunk[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuestion('')
    setAnswer('')
    setCut(false)
    setSources([])
    setScope(vaultMode ? 'doc' : 'doc')
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [open])

  // 流式输出时让答案区跟着滚
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [answer])

  const ask = useCallback(
    async (q: string) => {
      if (!q.trim()) return
      setBusy(true)
      setAnswer('')
      setCut(false)
      setSources([])
      const tuning = readAiTuning()

      try {
        if (scope === 'vault') {
          /* ---------- 全库问答：先召回，再让模型只根据材料回答 ---------- */
          if (!storage.context) {
            toast.info('浏览器模式没有知识库检索', '请用桌面版')
            return
          }
          const chunks = await storage.context(q, 8)
          if (!chunks.length) {
            setAnswer('知识库里没找到相关内容。\n\n换个说法再问一次，或者先在设置里确认检索范围。')
            return
          }
          setSources(chunks)
          const material = chunks
            .map((c, i) => {
              const where = c.chapter ? ` · ${c.chapter}` : ''
              return `[${i + 1}]《${c.title}》${where}（第 ${c.line} 行）\n${c.text}`
            })
            .join('\n\n')
          await aiStream(
            {
              system: withStyle(VAULT_SYSTEM, tuning),
              prompt: `【知识库检索结果】\n${material}\n\n【问题】${q}`,
              maxTokens: tuning.answerTokens,
              temperature: tuning.temperature,
            },
            (full) => setAnswer(full),
            (info) => setCut(info.truncated),
          )
          return
        }

        /* ---------- 问这一篇：和以前一样，整篇丢进去 ---------- */
        const text = plainText(content ?? undefined).slice(0, 6000)
        if (!text.trim()) {
          toast.info('文档内容为空', '无从提问')
          return
        }
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
    [content, scope, title],
  )

  if (!open) return null

  return (
    <div className="aichat">
      <div className="aichat-head">
        <span className="aichat-title">{scope === 'vault' ? '问整个知识库' : '问这篇文档'}</span>
        {vaultMode && (
          <span className="aichat-scope">
            <button
              className={scope === 'doc' ? 'on' : ''}
              onClick={() => setScope('doc')}
              title="只问当前这一篇"
            >
              这篇
            </button>
            <button
              className={scope === 'vault' ? 'on' : ''}
              onClick={() => setScope('vault')}
              title="在全部文档里检索后再回答"
            >
              全库
            </button>
          </span>
        )}
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
        {busy && !answer && (
          <div className="aichat-wait">{scope === 'vault' ? '正在检索知识库…' : '正在阅读文档…'}</div>
        )}
        {answer && <div className="aichat-answer">{answer}</div>}
        {sources.length > 0 && (
          <div className="aichat-sources">
            <div className="aichat-sources-title">依据（点开跳到原文）</div>
            {sources.map((c, i) => (
              <button
                key={`${c.file}-${c.line}`}
                className="aichat-source"
                title={`${c.file} · 第 ${c.line} 行`}
                onClick={() => {
                  /* 跳到那一段：拿命中行开头一小截当锚点，编辑器自己再扫一遍 */
                  const needle = c.text.trim().split('\n')[0].slice(0, 24)
                  onOpenSource?.(c.file, needle)
                }}
              >
                <span className="n">{i + 1}</span>
                <span className="t">{c.title}</span>
                {c.chapter && <span className="c">{c.chapter}</span>}
              </button>
            ))}
          </div>
        )}
        {cut && !busy && (
          <div className="ai-trunc">
            回答可能没写完 · 已到长度上限，可在设置 · AI 助手中调高「回答长度」
          </div>
        )}
      </div>

      {answer && !busy && (
        <div className="aichat-actions">
          <button className="btn" onClick={() => onInsert(answer)}>
            插入文末
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
          placeholder={scope === 'vault' ? '问整个知识库 · 回车发送' : '向这篇文档提问 · 回车发送'}
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
