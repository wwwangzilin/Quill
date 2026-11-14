export type ToastKind = 'success' | 'error' | 'info'

/** 提示上的按钮 —— 例如「上次读到这儿，要跳过去吗」 */
export interface ToastAction {
  label: string
  primary?: boolean
  run: () => void
}

export interface ToastItem {
  id: number
  kind: ToastKind
  text: string
  detail?: string
  actions?: ToastAction[]
}

type Listener = (items: ToastItem[]) => void

let items: ToastItem[] = []
let seq = 0
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l(items)
}

/** `ms <= 0` 表示不自动消失 —— 带按钮的那种得等用户按 */
function push(kind: ToastKind, text: string, detail?: string, ms = 2600, actions?: ToastAction[]) {
  const id = ++seq
  items = [...items, { id, kind, text, detail, actions }]
  emit()
  if (ms > 0) {
    window.setTimeout(() => {
      items = items.filter((t) => t.id !== id)
      emit()
    }, ms)
  }
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id)
  emit()
}

export const toast = {
  success: (text: string, detail?: string) => push('success', text, detail),
  info: (text: string, detail?: string) => push('info', text, detail),
  error: (text: string, detail?: string) => push('error', text, detail, 4600),
  /**
   * 带按钮的提示，**不自动消失**，等用户按。
   *
   * 「上次读到哪儿」用它：自动跳过去太自作主张（人可能就是想从头看），
   * 光提示一句又没处可点 —— 那就成了一句废话。
   */
  ask: (text: string, detail: string, actions: ToastAction[]) =>
    push('info', text, detail, 0, actions),
  dismiss,
  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
