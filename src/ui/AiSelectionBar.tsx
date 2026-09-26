import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { aiStream } from '../core/ai'
import { readAiTuning, withStyle } from '../core/aiPrefs'
import { toast } from './toast'

interface Props {
  editor: Editor | null
  /** 用来把「视口坐标」换算成容器内坐标 */
  host: React.RefObject<HTMLDivElement | null>
  /** 给选中的这段加一条批注（打开右侧批注面板） */
  onComment?: (text: string, from: number, to: number) => void
}

interface Target {
  from: number
  to: number
  text: string
  x: number
  y: number
  /** 选区太靠上、上方放不下时翻到下面去（否则会被滚动区裁掉） */
  flip: boolean
}

const ACTIONS = [
  { id: 'polish', label: '润色', ask: '在不改变原意的前提下，把这段文字改得更通顺、更有表达力。' },
  { id: 'tighten', label: '精简', ask: '把这段文字压到原来一半左右，保留全部关键信息，删掉废话。' },
  { id: 'expand', label: '扩写', ask: '把这段文字扩写到两到三倍，补充细节或例子，保持原有语气。' },
  { id: 'fix', label: '纠错', ask: '只改正错别字、标点和语病，其余尽量保持不动。' },
  { id: 'formal', label: '正式', ask: '改成更正式、更书面的表达。' },
  { id: 'casual', label: '口语', ask: '改成更口语、更自然随意的表达。' },
  { id: 'en', label: '译英', ask: '翻译成地道、简洁的英文。' },
]

const SYSTEM = `你是中文写作的编辑。只输出改写后的正文本身：
- 不要解释、不要复述要求，不要写「改写后：」这类前缀，也不要用引号或代码围栏包起来
- 保持原有的段落结构，以及原文用到的 Markdown 标记（标题、列表、加粗、链接等）
- 除非要求里明确说了改长度，否则与原文篇幅相当
- 只动该动的地方，其余原样保留`

const MAX_CHARS = 1500

/**
 * 选中一段文字 → 浮出一条小工具栏 → 润色/精简/扩写……
 * 结果先流式显示在浮条里，点「采纳」才真正改文档（走正常事务，可撤销）。
 */
export default function AiSelectionBar({ editor, host, onComment }: Props) {
  const [target, setTarget] = useState<Target | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [result, setResult] = useState('')
  /** 结果撞上长度上限被砍断了：照样能采纳，但得让人知道它不完整 */
  const [cut, setCut] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const seq = useRef(0)

  const close = useCallback(() => {
    seq.current += 1
    setTarget(null)
    setResult('')
    setRunning(null)
    setCut(false)
    setExpanded(false)
  }, [])

  // 跟着选区走
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const view = editor.view

    const update = () => {
      const { from, to, empty } = view.state.selection
      // 正在跑或已有结果时不跟着动，免得手一抖就没了
      if (running || result) return
      if (empty || to - from < 2) {
        setTarget(null)
        return
      }
      const text = view.state.doc.textBetween(from, to, '\n', '\ufffc')
      const trimmed = text.trim()
      if (trimmed.length < 2 || trimmed.length > MAX_CHARS) {
        setTarget(null)
        return
      }
      const rect = host.current?.getBoundingClientRect()
      if (!rect) return
      try {
        const a = view.coordsAtPos(from)
        const b = view.coordsAtPos(to)
        const topY = Math.min(a.top, b.top) - rect.top
        const flip = topY < 64
        setTarget({
          from,
          to,
          text: trimmed,
          x: (a.left + b.right) / 2 - rect.left,
          y: flip ? Math.max(a.bottom, b.bottom) - rect.top : topY,
          flip,
        })
      } catch {
        setTarget(null)
      }
    }

    editor.on('selectionUpdate', update)
    return () => {
      editor.off('selectionUpdate', update)
    }
  }, [editor, host, running, result])

  const run = useCallback(
    async (id: string, ask: string) => {
      if (!editor || !target) return
      const mine = (seq.current += 1)
      setRunning(id)
      setExpanded(true)
      setResult('')
      setCut(false)
      const tuning = readAiTuning()
      try {
        await aiStream(
          {
            system: withStyle(SYSTEM, tuning),
            prompt: `【改写要求】${ask}\n\n【原文】\n${target.text}`,
            maxTokens: tuning.rewriteTokens,
            temperature: tuning.temperature,
          },
          (full) => {
            if (mine === seq.current) setResult(full)
          },
          (info) => {
            // 选中的段落可能上千字，上限给不够就会说到一半断掉。
            // 结果照旧可用，但界面上要留个记号，免得让人以为模型就这水平
            if (mine === seq.current) setCut(info.truncated)
          },
        )
      } catch (err) {
        if (mine === seq.current) {
          setExpanded(false)
          toast.error('AI 改写失败', String(err).slice(0, 160))
        }
      } finally {
        if (mine === seq.current) setRunning(null)
      }
    },
    [editor, target],
  )

  const accept = useCallback(() => {
    if (!editor || !target || !result.trim()) return
    const { state, view } = editor
    // 期间文档被改过的话位置就不作数了，别乱插
    const now = state.doc.textBetween(target.from, target.to, '\n', '\ufffc').trim()
    if (now !== target.text) {
      toast.error('文档已改动', '请重新选中该段文字')
      close()
      return
    }
    view.dispatch(state.tr.insertText(result.trim(), target.from, target.to))
    toast.success('已替换', '可按 Ctrl+Z 撤销')
    seq.current += 1
    setTarget(null)
    setResult('')
    setRunning(null)
    setCut(false)
    setExpanded(false)
  }, [editor, target, result, close])

  if (!target) return null

  return (
    <div
      className={'ai-sel' + (expanded ? ' expanded' : '') + (target.flip ? ' flip' : '')}
      style={{ left: `${target.x}px`, top: `${target.y}px` }}
      // 关键：不让按钮把焦点抢走，否则编辑器选区一丢，替换就没了落点
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).tagName !== 'TEXTAREA') e.preventDefault()
      }}
    >
      {!expanded ? (
        <div className="ai-sel-row">
          <span className="ai-sel-tag">AI</span>
          {ACTIONS.map((a) => (
            <button key={a.id} className="ai-sel-btn" onClick={() => void run(a.id, a.ask)}>
              {a.label}
            </button>
          ))}
          {onComment && (
            <>
              <span className="ai-sel-sep" />
              <button
                className="ai-sel-btn"
                title="给这段文字加一条批注"
                onClick={() => {
                  onComment(target.text, target.from, target.to)
                  close()
                }}
              >
                ＋ 批注
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="ai-sel-panel">
          <div className="ai-sel-head">
            <span className="ai-sel-tag">AI</span>
            <span className="ai-sel-status">
              {running ? `正在${ACTIONS.find((a) => a.id === running)?.label ?? '改写'}…` : '改写结果'}
            </span>
            <span className="grow" />
            <button className="ai-sel-mini" onClick={close} title="收起">
              ×
            </button>
          </div>

          <div className="ai-sel-body">{result || '…'}</div>

          {cut && !running && (
            <div className="ai-trunc">
              结果可能没写完 · 已到长度上限，可在设置 · AI 助手中调高「改写长度」
            </div>
          )}

          <div className="ai-sel-foot">
            <button className="btn primary" disabled={!result.trim() || !!running} onClick={accept}>
              采纳
            </button>
            <button className="btn" disabled={!result.trim() || !!running} onClick={() => void run(running ?? 'polish', ACTIONS.find((a) => a.id === (running ?? 'polish'))?.ask ?? '')}>
              重来
            </button>
            <span className="grow" />
            <button
              className="btn ghost"
              onClick={() => {
                void navigator.clipboard.writeText(result)
                toast.success('已复制')
              }}
              disabled={!result.trim()}
            >
              复制
            </button>
            <button className="btn ghost" onClick={close}>
              放弃
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
