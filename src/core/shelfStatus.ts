/**
 * 书架状态：想读 / 在读 / 读完。
 * 没手动设过的书由阅读统计推断（读完过 → 读完；读过 → 在读；没读过 → 不归类），
 * 手动设过的以手动为准。纯函数；手动状态存 localStorage。
 */
export type Status = 'want' | 'reading' | 'done'

export const STATUS_LIST: { id: Status; name: string }[] = [
  { id: 'reading', name: '在读' },
  { id: 'want', name: '想读' },
  { id: 'done', name: '读完' },
]

export const isStatus = (v: unknown): v is Status => STATUS_LIST.some((s) => s.id === v)

export function effectiveStatus(
  manual: Status | undefined,
  book: { secs: number; done?: number } | undefined,
): Status | undefined {
  if (manual) return manual
  if (book?.done) return 'done'
  if (book && book.secs > 0) return 'reading'
  return undefined
}

export interface StatusGroup {
  id: string
  name: string
  count: number
}

/** 'st:reading' 这样的分组 id；没有书的状态不列 */
export function statusGroups(ids: string[], statusOf: (id: string) => Status | undefined): StatusGroup[] {
  const count: Record<Status, number> = { want: 0, reading: 0, done: 0 }
  for (const id of ids) {
    const s = statusOf(id)
    if (s) count[s] += 1
  }
  return STATUS_LIST.filter((s) => count[s.id] > 0).map((s) => ({ id: `st:${s.id}`, name: s.name, count: count[s.id] }))
}

export const isStatusGroup = (gid: string) => gid.startsWith('st:')

export function inStatusGroup(gid: string, s: Status | undefined): boolean {
  return gid === `st:${s}`
}

const KEY = 'quill-set:shelf-status'
export function loadStatuses(): Record<string, Status> {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    const out: Record<string, Status> = {}
    if (j && typeof j === 'object') for (const [k, v] of Object.entries(j)) if (isStatus(v)) out[k] = v
    return out
  } catch {
    return {}
  }
}
export function saveStatuses(m: Record<string, Status>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* 记不住就算了 */
  }
}
/** 设置或清除（undefined = 回到自动推断） */
export function setStatus(m: Record<string, Status>, id: string, s: Status | undefined): Record<string, Status> {
  const next = { ...m }
  if (s) next[id] = s
  else delete next[id]
  return next
}
