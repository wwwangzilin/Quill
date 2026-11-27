/**
 * 每本书单独的阅读排版：`{ [docId]: 样式 }` 存一张表。
 * 纯函数 + 注入 storage，node 下可直接测；样式的校验/补默认由 readerStyle 负责。
 * 表最多留 200 本，超出丢最早写入的（对象键保持插入顺序，重写时挪到最后）。
 */
export interface KV {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

export const BOOK_STYLE_KEY = 'quill-set:bookStyles'
export const BOOK_STYLE_MAX = 200

export function readBookMap(st: KV): Record<string, unknown> {
  try {
    const raw = st.getItem(BOOK_STYLE_KEY)
    if (!raw) return {}
    const o = JSON.parse(raw)
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function getBookStyle(st: KV, id: string): unknown | null {
  const m = readBookMap(st)
  return Object.prototype.hasOwnProperty.call(m, id) ? m[id] : null
}

/** value 为 null = 删掉这本书的专属设置，回到全局 */
export function setBookStyle(st: KV, id: string, value: unknown | null): void {
  const m = readBookMap(st)
  delete m[id]
  if (value !== null) m[id] = value
  const keys = Object.keys(m)
  for (const k of keys.slice(0, Math.max(0, keys.length - BOOK_STYLE_MAX))) delete m[k]
  try {
    st.setItem(BOOK_STYLE_KEY, JSON.stringify(m))
  } catch {
    /* 写不进去只是记不住 */
  }
}
