/**
 * 书架分组：侧栏 3D 书架可以只看某一组书（全部 / 星标 / 长篇 / 某个标签）。
 * 纯函数；分组只影响书架，不动下面的文档列表。
 */
import type { DocMeta } from './types'

export interface ShelfGroup {
  /** 'all' | 'starred' | 'long' | 'tag:<标签>' */
  id: string
  name: string
  count: number
}

/** 正文去空白字数达到这个数就算「长篇」（小说、长文） */
export const LONG_CHARS = 30000
const MAX_TAGS = 8

export function inGroup(d: DocMeta, id: string): boolean {
  if (id === 'all') return true
  if (id === 'starred') return d.starred
  if (id === 'long') return (d.chars ?? 0) >= LONG_CHARS
  if (id.startsWith('tag:')) return (d.tags ?? []).includes(id.slice(4))
  return true
}

export function filterShelf(docs: DocMeta[], id: string): DocMeta[] {
  return id === 'all' ? docs : docs.filter((d) => inGroup(d, id))
}

/**
 * 当前有哪些分组可选。空的组不列（星标一本都没有就别摆个 0 在那）；
 * 标签按篇数从多到少，最多列 8 个，免得芯片行挤成一团。
 */
export function shelfGroups(docs: DocMeta[]): ShelfGroup[] {
  const out: ShelfGroup[] = [{ id: 'all', name: '全部', count: docs.length }]
  const starred = docs.filter((d) => d.starred).length
  if (starred) out.push({ id: 'starred', name: '星标', count: starred })
  const long = docs.filter((d) => (d.chars ?? 0) >= LONG_CHARS).length
  if (long) out.push({ id: 'long', name: '长篇', count: long })
  const tagCount = new Map<string, number>()
  for (const d of docs) for (const t of new Set(d.tags ?? [])) tagCount.set(t, (tagCount.get(t) ?? 0) + 1)
  const tags = [...tagCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh')).slice(0, MAX_TAGS)
  for (const [t, n] of tags) out.push({ id: `tag:${t}`, name: t, count: n })
  return out
}

/** 选中的组已经不存在了（标签被删光），回到「全部」 */
export function resolveGroup(groups: ShelfGroup[], id: string): string {
  return groups.some((g) => g.id === id) ? id : 'all'
}
