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
          </span>
        </div>
      ))}
    </div>
  )
}
