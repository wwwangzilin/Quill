/**
 * 阅读器的书签：状态、分类筛选、跳转。
 *
 * 这些原来散在 ReaderView 的组件体里（`bms` / `marked` / `flipBookmark` / `goBookmark` …），
 * 和分页、朗读、批注搅在一起。它其实只依赖三样外部东西：
 * 当前是哪一屏、这本书有哪些章、以及「怎么跳到某一章某一屏」。
 * 所以整块搬进 hook，阅读器只留一行调用。
 */
import { useCallback, useMemo, useState, type MutableRefObject } from 'react'
import {
  catCounts,
  filterBookmarks,
  nextCat,
  readBookmarks,
  sameSpot,
  setBookmarkCat,
  toggleBookmark,
  writeBookmarks,
  type BmCat,
  type Bookmark,
} from '../../core/bookmarks'
import { toast } from '../toast'

interface Args {
  docId: string
  /** 是否按章阅读（整篇连读时书签只有屏号） */
  slicing: boolean
  /** 当前章标题（整篇连读时为 undefined） */
  chapterTitle?: string
  /** 当前第几屏 */
  page: number
  chapters: { title: string }[]
  ci: number
  pages: number
  setCi: (n: number) => void
  setPage: (n: number) => void
  /** 换章后要落回第几屏（阅读器里 measure 之后兑现） */
  wantPage: MutableRefObject<number | null>
  /** 换章时别把页码重置成 0 */
  skipReset: MutableRefObject<boolean>
}

export function useBookmarks({
  docId,
  slicing,
  chapterTitle,
  page,
  chapters,
  ci,
  pages,
  setCi,
  setPage,
  wantPage,
  skipReset,
}: Args) {
  const [bms, setBms] = useState<Bookmark[]>(() => readBookmarks(docId))
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<BmCat | 'all' | 'none'>('all')

  const marked = bms.some((b) => sameSpot(b, { chapter: chapterTitle, page }))
  const shown = useMemo(() => filterBookmarks(bms, filter), [bms, filter])
  const catStat = useMemo(() => catCounts(bms), [bms])

  const flip = useCallback(() => {
    setBms((list) => {
      // 正看着某个分类的话，新加的书签直接归进去
      const next = toggleBookmark(
        list,
        { chapter: chapterTitle, page },
        Date.now(),
        filter === 'all' || filter === 'none' ? undefined : filter,
      )
      writeBookmarks(docId, next)
      return next
    })
  }, [docId, chapterTitle, page, filter])

  const cycleCat = useCallback(
    (id: string) => {
      setBms((list) => {
        const cur = list.find((b) => b.id === id)
        const next = setBookmarkCat(list, id, nextCat(cur?.cat))
        writeBookmarks(docId, next)
        return next
      })
    },
    [docId],
  )

  const go = useCallback(
    (b: Bookmark) => {
      setOpen(false)
      const idx = b.chapter ? chapters.findIndex((c) => c.title === b.chapter) : 0
      if (b.chapter && idx < 0) {
        toast.info('书签的那一章找不到了', '章标题可能改过')
        return
      }
      if (slicing && idx !== ci) {
        // 和「上次读到哪儿」同一套：先记下要回到的屏，再换章，换章后 measure 兑现
        wantPage.current = b.page
        skipReset.current = true
        setCi(idx)
      } else {
        setPage(Math.max(0, Math.min(b.page, pages - 1)))
      }
    },
    [chapters, slicing, ci, pages, setCi, setPage, wantPage, skipReset],
  )

  const drop = useCallback(
    (id: string) => {
      setBms((list) => {
        const next = list.filter((b) => b.id !== id)
        writeBookmarks(docId, next)
        return next
      })
    },
    [docId],
  )

  return {
    bms,
    marked,
    shown,
    catStat,
    open,
    setOpen,
    filter,
    setFilter,
    flip,
    cycleCat,
    go,
    drop,
  }
}
