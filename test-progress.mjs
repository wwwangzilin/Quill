import assert from 'node:assert/strict'
import { mergeProgress, mergeBookmarks, parseProgress, emptyProgress, progressEqual } from './src/core/progress.ts'
let n = 0
const ok = (f) => { f(); n++ }
const bm = (id, chapter, page, at, cat) => ({ id, chapter, page, label: id, at, ...(cat ? { cat } : {}) })
const names = new Set(['a.md', 'b.md'])
const L = { version: 1, pos: { 'a.md': { chapter: '第三章', page: 2, at: 100 }, 'b.md': { chapter: '序', page: 0, at: 500 } }, bookmarks: { 'a.md': [bm('x1', '第一章', 0, 10)] } }
const R = { version: 1, pos: { 'a.md': { chapter: '第九章', page: 1, at: 300 }, 'b.md': { chapter: '旧', page: 9, at: 50 }, 'zz.md': { chapter: 'x', at: 1 } }, bookmarks: { 'a.md': [bm('y1', '第一章', 0, 20, 'key'), bm('y2', '第二章', 3, 30)], 'zz.md': [bm('q', '', 0, 1)] } }
const m = mergeProgress(L, R, names)
ok(() => assert.equal(m.merged.pos['a.md'].chapter, '第九章')) // 远端更新
ok(() => assert.equal(m.merged.pos['b.md'].chapter, '序')) // 本地更新
ok(() => assert.deepEqual(Object.keys(m.posToApply), ['a.md']))
ok(() => assert.equal(m.merged.pos['zz.md'], undefined)) // 本地没有的书不带
ok(() => assert.deepEqual(m.merged.bookmarks['a.md'].map((b) => b.id), ['y1', 'y2'])) // 同一屏：带分类的留下
ok(() => assert.deepEqual(Object.keys(m.bookmarksToApply), ['a.md']))
ok(() => assert.deepEqual(mergeBookmarks([bm('a', 'c', 1, 5)], [bm('b', 'c', 1, 3)]).map((b) => b.id), ['b'])) // 都没分类：先打的留下
ok(() => assert.deepEqual(mergeBookmarks([bm('a', 'c', 1, 5)], [bm('a', 'c', 1, 5)]).length, 1)) // 同 id 去重
const again = mergeProgress(m.merged, m.merged, names)
ok(() => assert.deepEqual([Object.keys(again.posToApply).length, Object.keys(again.bookmarksToApply).length], [0, 0])) // 幂等
ok(() => assert.equal(progressEqual(again.merged, m.merged), true))
ok(() => assert.deepEqual(parseProgress('{坏'), emptyProgress()))
ok(() => assert.deepEqual(Object.keys(parseProgress('{"pos":{"a":{"at":1},"b":{"x":1},"c":5}}').pos), ['a']))
ok(() => assert.deepEqual(parseProgress('{"bookmarks":{"a":[{"id":"1","page":2,"at":3},{"id":2}]}}').bookmarks.a.length, 1))
console.log(`全部通过：${n} 项`)
