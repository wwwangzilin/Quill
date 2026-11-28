/** 批注标签：解析输入、统计、筛选。纯函数。 */
export const MAX_TAGS = 6
export const MAX_TAG_LEN = 12

/** 「伏笔, 金句；#待查」→ ['伏笔','金句','待查']：逗号 / 顿号 / 分号 / 空白 / # 都当分隔，去重，限长限数 */
export function parseTags(input: string): string[] {
  const out: string[] = []
  for (const raw of input.split(/[,，、;；\s#＃]+/)) {
    const t = raw.trim().slice(0, MAX_TAG_LEN)
    if (t && !out.includes(t)) out.push(t)
    if (out.length >= MAX_TAGS) break
  }
  return out
}

/** 输入框里显示用：['伏笔','金句'] → "伏笔 金句" */
export const tagsText = (tags: string[] | undefined) => (tags ?? []).join(' ')

export function tagCounts(list: { tags?: string[] }[]): { tag: string; n: number }[] {
  const m = new Map<string, number>()
  for (const c of list) for (const t of new Set(c.tags ?? [])) m.set(t, (m.get(t) ?? 0) + 1)
  return [...m.entries()].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag, 'zh'))
}

/** 'all' 全部，'none' 没打标签的，其余按标签名 */
export function filterByTag<T extends { tags?: string[] }>(list: T[], f: string): T[] {
  if (f === 'all') return list
  if (f === 'none') return list.filter((c) => !(c.tags && c.tags.length))
  return list.filter((c) => c.tags?.includes(f))
}
