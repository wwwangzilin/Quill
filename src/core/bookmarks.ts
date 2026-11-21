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
}

const keyOf = (docId: string) => `quill:bookmarks:${docId}`

export function readBookmarks(docId: string): Bookmark[] {
  if (!docId) return []
  try {
    const j = JSON.parse(localStorage.getItem(keyOf(docId)) ?? '[]') as Bookmark[]
    return Array.isArray(j) ? j.filter((b) => b && typeof b.page === 'number') : []
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
export function toggleBookmark(list: Bookmark[], spot: { chapter?: string; page: number }, now = Date.now()): Bookmark[] {
  if (list.some((b) => sameSpot(b, spot))) return list.filter((b) => !sameSpot(b, spot))
  const label = spot.chapter ? `${spot.chapter} · 第 ${spot.page + 1} 屏` : `第 ${spot.page + 1} 屏`
  return [...list, { id: `b${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`, ...spot, label, at: now }]
}
