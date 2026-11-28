/**
 * 书架手动排序：存一串 id，排在前面的先摆；没在里面的（新文档）按原顺序接在后面。
 * 纯函数，node 下可测。
 */

/** 按 order 重排；order 里已不存在的 id 直接忽略，不在 order 里的文档保持原相对顺序排后面 */
export function applyOrder<T extends { id: string }>(docs: T[], order: string[]): T[] {
  if (!order.length) return docs
  const byId = new Map(docs.map((d) => [d.id, d]))
  const out: T[] = []
  const seen = new Set<string>()
  for (const id of order) {
    const d = byId.get(id)
    if (d && !seen.has(id)) {
      out.push(d)
      seen.add(id)
    }
  }
  for (const d of docs) if (!seen.has(d.id)) out.push(d)
  return out
}

/** 数组里把 from 位的挪到 to 位 */
export function moveIndex<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr
  const next = arr.slice()
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}

/**
 * 在「当前分组可见的那几本」里挪一本，返回新的**全量** order。
 * 不可见的书（别的分组）保持它们原来占的位置，只有可见的几个槽位里的内容换了顺序 ——
 * 不然在「星标」组里拖一下，别的组的排序就全乱了。
 */
export function reorderVisible(allIds: string[], visibleIds: string[], from: number, to: number): string[] {
  const moved = moveIndex(visibleIds, from, to)
  if (moved === visibleIds) return allIds
  const vis = new Set(visibleIds)
  let k = 0
  return allIds.map((id) => (vis.has(id) ? moved[k++] : id))
}
