/**
 * 阅读书签：记「这本书的哪一章第几屏」。
 *
 * 和阅读位置一样存 localStorage、不进文档仓库 —— 书签是这台机器上这个人的，
 * 往 .quill-meta.json 里写会触发自动 commit。章按标题认，不按序号（中间插一章序号就错位了）。
 */
export interface Bookmark {
  id: string
  /** 所在章的标题；整篇连读模式没有章 */
  chapter?: string
  /** 第几屏（0 基） */
  page: number
  /** 列表里显示的话：章标题 + 屏号 */
  label: string
  at: number
  /** 分类；没有就是未分类 */
  cat?: BmCat
}

export type BmCat = 'key' | 'todo' | 'love' | 'plot'

export const BM_CATS: { id: BmCat; name: string; color: string }[] = [
  { id: 'key', name: '重点', color: '#e5646b' },
  { id: 'todo', name: '待查', color: '#e0a23b' },
  { id: 'love', name: '喜欢', color: '#e0709b' },
  { id: 'plot', name: '伏笔', color: '#5a9fe0' },
]

export const isBmCat = (v: unknown): v is BmCat => BM_CATS.some((c) => c.id === v)

/** 未分类 → 重点 → 待查 → 喜欢 → 伏笔 → 未分类 */
export function nextCat(cur?: BmCat): BmCat | undefined {
  if (!cur) return BM_CATS[0].id
  const i = BM_CATS.findIndex((c) => c.id === cur)
  return BM_CATS[i + 1]?.id
}

export function setBookmarkCat(list: Bookmark[], id: string, cat: BmCat | undefined): Bookmark[] {
  return list.map((b) => {
    if (b.id !== id) return b
    const { cat: _old, ...rest } = b
    return cat ? { ...rest, cat } : rest
  })
}

/** 'all' 看全部，'none' 看未分类，其余按类 */
export function filterBookmarks(list: Bookmark[], f: BmCat | 'all' | 'none'): Bookmark[] {
  if (f === 'all') return list
  return list.filter((b) => (f === 'none' ? !b.cat : b.cat === f))
}

export function catCounts(list: Bookmark[]): Record<BmCat | 'none', number> {
  const r = { key: 0, todo: 0, love: 0, plot: 0, none: 0 }
  for (const b of list) r[b.cat ?? 'none'] += 1
  return r
}

const keyOf = (docId: string) => `quill:bookmarks:${docId}`

export function readBookmarks(docId: string): Bookmark[] {
  if (!docId) return []
  try {
    const j = JSON.parse(localStorage.getItem(keyOf(docId)) ?? '[]') as Bookmark[]
    return Array.isArray(j)
      ? j
          .filter((b) => b && typeof b.page === 'number')
          .map((b) => (b.cat !== undefined && !isBmCat(b.cat) ? { ...b, cat: undefined } : b))
      : []
  } catch {
    return []
  }
}

export function writeBookmarks(docId: string, list: Bookmark[]): void {
  if (!docId) return
  try {
    localStorage.setItem(keyOf(docId), JSON.stringify(list))
  } catch {
    /* 写不进去只是记不住 */
  }
}

export const sameSpot = (a: { chapter?: string; page: number }, b: { chapter?: string; page: number }) =>
  (a.chapter ?? '') === (b.chapter ?? '') && a.page === b.page

/** 这一屏有书签就摘掉，没有就加上；返回新列表（按章内顺序之外的位置不排序，保持添加先后） */
export function toggleBookmark(
  list: Bookmark[],
  spot: { chapter?: string; page: number },
  now = Date.now(),
  cat?: BmCat,
): Bookmark[] {
  if (list.some((b) => sameSpot(b, spot))) return list.filter((b) => !sameSpot(b, spot))
  const label = spot.chapter ? `${spot.chapter} · 第 ${spot.page + 1} 屏` : `第 ${spot.page + 1} 屏`
  return [...list, { id: `b${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`, ...spot, label, at: now, ...(cat ? { cat } : {}) }]
}
