// 书签：同一屏再点一次是取消，章按标题认（node 原生跑 TS）
import { sameSpot, toggleBookmark } from './src/core/bookmarks.ts'
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
console.log(`全部通过：${ok} 项`)
