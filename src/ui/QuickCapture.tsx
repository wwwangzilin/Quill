import { useEffect, useRef, useState } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (text: string) => void
}

/** 全局唤起后直接开写的那一小块地方：回车存进「收件箱」 */
export default function QuickCapture({ open, onClose, onSubmit }: Props) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return
    setText('')
    // 等浮层挂载完再聚焦，否则拿不到元素
    const timer = window.setTimeout(() => ref.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  if (!open) return null

  const submit = () => {
    const value = text.trim()
    if (!value) {
      onClose()
      return
    }
    onSubmit(value)
    onClose()
  }

  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className="quick-capture" onMouseDown={(e) => e.stopPropagation()}>
        <textarea
          ref={ref}
          value={text}
          placeholder="快速记录…"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="qc-foot">
          <span className="qc-hint">回车保存 · Shift+回车换行 · Esc 取消</span>
          <button className="btn primary" onClick={submit}>
            存进收件箱
          </button>
        </div>
      </div>
    </div>
  )
}
