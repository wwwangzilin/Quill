export type ToastKind = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  kind: ToastKind
  text: string
  detail?: string
}

type Listener = (items: ToastItem[]) => void

let items: ToastItem[] = []
let seq = 0
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l(items)
}

function push(kind: ToastKind, text: string, detail?: string, ms = 2600) {
  const id = ++seq
  items = [...items, { id, kind, text, detail }]
  emit()
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id)
    emit()
  }, ms)
}

export const toast = {
  success: (text: string, detail?: string) => push('success', text, detail),
  info: (text: string, detail?: string) => push('info', text, detail),
  error: (text: string, detail?: string) => push('error', text, detail, 4600),
  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
