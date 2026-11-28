import assert from 'node:assert/strict'
import { findAll, snippetOf, searchChapter, mergeHits, locateBlock } from './src/core/bookSearch.ts'
let n = 0
const ok = (f) => { f(); n++ }
ok(() => assert.deepEqual(findAll('Abc abc ABC', 'abc'), [{ from: 0, to: 3 }, { from: 4, to: 7 }, { from: 8, to: 11 }]))
ok(() => assert.deepEqual(findAll('aaaa', 'aa'), [{ from: 0, to: 2 }, { from: 2, to: 4 }])) // 不重叠
ok(() => assert.deepEqual(findAll('abc', ''), []))
ok(() => assert.deepEqual(findAll('abc', '  '), []))
ok(() => assert.equal(findAll('x'.repeat(50), 'x', 5).length, 5))
ok(() => assert.deepEqual(findAll('山高月小，水落石出。山高', '山高'), [{ from: 0, to: 2 }, { from: 10, to: 12 }]))
ok(() => assert.deepEqual(findAll('İstanbul İ', 'İ').length, 2)) // 变长字符不崩、下标仍对
ok(() => { const t = '你好，山高月小，水落石出，再见。'; const [r] = findAll(t, '月小'); const s = snippetOf(t, r, 3); assert.equal(s.mid, '月小'); assert.ok(s.pre.startsWith('…')); assert.ok(s.post.endsWith('…')) })
ok(() => { const s = snippetOf('abc', { from: 0, to: 1 }, 5); assert.equal(s.pre, ''); assert.equal(s.post, 'bc') })
ok(() => { const t = 'a\n\nb  关键词  c'; const [h] = searchChapter(t, '关键词', 9); assert.ok(!/\n/.test(h.pre)) })
ok(() => {
  const r = mergeHits(['一', '二', '三'], ['无', '有 关键 有 关键', undefined], '关键')
  assert.equal(r.total, 2); assert.equal(r.groups.length, 1); assert.equal(r.groups[0].ci, 1); assert.equal(r.truncated, false)
})
ok(() => {
  const r = mergeHits(['一', '二'], ['x x x', 'x x'], 'x', 4)
  assert.equal(r.total, 4); assert.equal(r.truncated, true); assert.equal(r.groups[1].hits.length, 1)
})
ok(() => { const r = mergeHits(['一'], ['x x x'], 'x', 3); assert.equal(r.truncated, false) }) // 正好等于上限不算截断
ok(() => { assert.deepEqual(locateBlock([0, 10, 25], 0), { block: 0, local: 0 }); assert.deepEqual(locateBlock([0, 10, 25], 10), { block: 1, local: 0 }); assert.deepEqual(locateBlock([0, 10, 25], 30), { block: 2, local: 5 }); assert.deepEqual(locateBlock([], 3), { block: 0, local: 3 }) })
console.log(`全部通过：${n} 项`)
