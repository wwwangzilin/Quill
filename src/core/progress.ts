/**
 * 多设备阅读进度：阅读位置 + 书签的合并。纯函数，node 下可测。
 *
 * 阅读位置（lastPos）和书签都只存在本机 localStorage，换台电脑就从头读。
 * WebDAV 同步时把它们也带上：
 *   · 位置：每本书取「最近读的那一份」（at 大的赢）
 *   · 书签：按 id 取并集；两台机器各在同一章同一屏打的书签（id 不同、位置相同）只留一个
 * 章是按标题记的，所以跨设备能对上；「第几屏」会因屏幕大小不同而偏几屏，落在同一章里。
 * 阅读统计不同步 —— 它是「这台机器读了多久」，合并只会重复计数。
 */
import type { Bookmark } from './bookmarks'
import type { DocPos } from './lastPos'

export interface ProgressSnap {
  version: 1
  pos: Record<string, DocPos>
  bookmarks: Record<string, Bookmark[]>
}

export const PROGRESS_REMOTE = '.quill-sync-progress.json'
export const emptyProgress = (): ProgressSnap => ({ version: 1, pos: {}, bookmarks: {} })

/** 远端文件可能是别的版本写的或被改坏：能用多少用多少，绝不抛 */
export function parseProgress(text: string): ProgressSnap {
  const out = emptyProgress()
  try {
    const o = JSON.parse(text) as Partial<ProgressSnap>
    if (o.pos && typeof o.pos === 'object') {
      for (const [k, v] of Object.entries(o.pos)) {
        if (v && typeof v === 'object' && typeof (v as DocPos).at === 'number') out.pos[k] = v as DocPos
      }
    }
    if (o.bookmarks && typeof o.bookmarks === 'object') {
      for (const [k, v] of Object.entries(o.bookmarks)) {
        if (!Array.isArray(v)) continue
        out.bookmarks[k] = v.filter(
          (b): b is Bookmark => !!b && typeof b.id === 'string' && typeof b.page === 'number' && typeof b.at === 'number',
        )
      }
    }
  } catch {
    /* 坏 JSON 当空的 */
  }
  return out
}

const spotKey = (b: Bookmark) => `${b.chapter ?? ''}\u0000${b.page}`

export function mergeBookmarks(a: Bookmark[], b: Bookmark[]): Bookmark[] {
  const byId = new Map<string, Bookmark>()
  for (const x of [...a, ...b]) if (!byId.has(x.id)) byId.set(x.id, x)
  // 同一章同一屏只留一个：优先带分类的，其次先打的
  const bySpot = new Map<string, Bookmark>()
  for (const x of byId.values()) {
    const k = spotKey(x)
    const cur = bySpot.get(k)
    if (!cur || (!cur.cat && x.cat) || (!!cur.cat === !!x.cat && x.at < cur.at)) bySpot.set(k, x)
  }
  return [...bySpot.values()].sort((p, q) => p.at - q.at)
}

export interface ProgressMerge {
  merged: ProgressSnap
  /** 要写回本地的位置（远端更新的那些） */
  posToApply: Record<string, DocPos>
  /** 要写回本地的书签（合并后和本地不一样的那些） */
  bookmarksToApply: Record<string, Bookmark[]>
}

export function mergeProgress(local: ProgressSnap, remote: ProgressSnap, names: Set<string>): ProgressMerge {
  const merged = emptyProgress()
  const posToApply: Record<string, DocPos> = {}
  const bookmarksToApply: Record<string, Bookmark[]> = {}
  for (const n of names) {
    const lp = local.pos[n]
    const rp = remote.pos[n]
    if (lp && rp) {
      if (rp.at > lp.at) {
        merged.pos[n] = rp
        posToApply[n] = rp
      } else merged.pos[n] = lp
    } else if (lp) merged.pos[n] = lp
    else if (rp) {
      merged.pos[n] = rp
      posToApply[n] = rp
    }

    const lb = local.bookmarks[n] ?? []
    const mb = mergeBookmarks(lb, remote.bookmarks[n] ?? [])
    if (mb.length) merged.bookmarks[n] = mb
    const same = mb.length === lb.length && mb.every((b, i) => lb[i] && lb[i].id === b.id && lb[i].cat === b.cat)
    if (!same) bookmarksToApply[n] = mb
  }
  return { merged, posToApply, bookmarksToApply }
}

export const progressEqual = (a: ProgressSnap, b: ProgressSnap) => JSON.stringify(a) === JSON.stringify(b)
