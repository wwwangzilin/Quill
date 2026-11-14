import { useEffect, useState } from 'react'
import { toast, type ToastItem } from './toast'

const ICON: Record<ToastItem['kind'], string> = {
  success: '✓',
  error: '!',
  info: 'i',
}

export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => toast.subscribe(setItems), [])

  if (!items.length) return null

  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span className="t-icon">{ICON[t.kind]}</span>
          <span className="t-body">
            <span className="t-text">{t.text}</span>
            {t.detail && <span className="t-detail">{t.detail}</span>}
            {/* 带按钮的提示（「上次读到这儿」这类）—— 按了才动，也按了才消失 */}
            {t.actions && t.actions.length > 0 && (
              <span className="t-acts">
                {t.actions.map((a) => (
                  <button
                    key={a.label}
                    className={'btn mini' + (a.primary ? ' primary' : ' ghost')}
                    onClick={() => {
                      a.run()
                      toast.dismiss(t.id)
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
