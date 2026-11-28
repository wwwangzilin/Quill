// 书签：同一屏再点一次是取消，章按标题认（node 原生跑 TS）
import { sameSpot, toggleBookmark, nextCat, setBookmarkCat, filterBookmarks, catCounts, readBookmarks, writeBookmarks, BM_CATS } from './src/core/bookmarks.ts'
let ok = 0
function eq(name, got, want) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`✗ ${name}\n  期望: ${JSON.stringify(want)}\n  实际: ${JSON.stringify(got)}`)
    process.exit(1)
  }
  ok++
}
let l = toggleBookmark([], { chapter: '第一章', page: 2 }, 1)
eq('添加', [l.length, l[0].label, l[0].page], [1, '第一章 · 第 3 屏', 2])
l = toggleBookmark(l, { chapter: '第一章', page: 3 }, 2)
eq('另一屏是新增', l.length, 2)
l = toggleBookmark(l, { chapter: '第一章', page: 2 }, 3)
eq('同一屏再点是取消', l.map((b) => b.page), [3])
eq('章不同算不同位置', sameSpot({ chapter: 'A', page: 1 }, { chapter: 'B', page: 1 }), false)
eq('整篇模式（无章）', toggleBookmark([], { page: 0 }, 1)[0].label, '第 1 屏')
// ---- 分类 ----
eq('循环：无→重点→待查→喜欢→伏笔→无', [undefined, 'key', 'todo', 'love', 'plot'].map((c) => nextCat(c)), ['key', 'todo', 'love', 'plot', undefined])
let c = toggleBookmark([], { page: 0 }, 1, 'todo')
eq('带分类添加', c[0].cat, 'todo')
c = toggleBookmark(c, { page: 1 }, 2)
c = setBookmarkCat(c, c[1].id, 'key')
eq('设置分类', c.map((b) => b.cat), ['todo', 'key'])
c = setBookmarkCat(c, c[0].id, undefined)
eq('清除分类时不留 cat 键', 'cat' in c[0], false)
eq('筛选', [filterBookmarks(c, 'all').length, filterBookmarks(c, 'none').length, filterBookmarks(c, 'key').length, filterBookmarks(c, 'plot').length], [2, 1, 1, 0])
eq('计数', catCounts(c), { key: 1, todo: 0, love: 0, plot: 0, none: 1 })
eq('四个分类', BM_CATS.length, 4)

// ---- 按文档隔离的持久化 ----
const store = new Map()
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
}
const bookA = toggleBookmark([], { chapter: '甲书第一章', page: 1 }, 10)
const bookB = toggleBookmark([], { chapter: '乙书第一章', page: 4 }, 20)
writeBookmarks('doc-a', bookA)
writeBookmarks('doc-b', bookB)
eq('读取 A 文档书签', readBookmarks('doc-a').map((b) => b.label), ['甲书第一章 · 第 2 屏'])
eq('读取 B 文档书签', readBookmarks('doc-b').map((b) => b.label), ['乙书第一章 · 第 5 屏'])
eq('空文档 ID 不读取其他书签', readBookmarks(''), [])
store.set('quill:bookmarks:broken', '{not-json')
eq('损坏存储安全回退为空列表', readBookmarks('broken'), [])

console.log(`全部通过：${ok} 项`)
