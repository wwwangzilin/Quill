import assert from 'node:assert/strict'
import { applyOrder, moveIndex, reorderVisible } from './src/core/shelfOrder.ts'
const D = (...ids) => ids.map((id) => ({ id }))
const ids = (a) => a.map((d) => d.id)
let n = 0
const ok = (f) => { f(); n++ }
ok(() => assert.deepEqual(ids(applyOrder(D('a', 'b', 'c'), [])), ['a', 'b', 'c']))
ok(() => assert.deepEqual(ids(applyOrder(D('a', 'b', 'c'), ['c', 'a'])), ['c', 'a', 'b'])) // 没提到的接后面
ok(() => assert.deepEqual(ids(applyOrder(D('a', 'b'), ['x', 'b', 'b', 'a'])), ['b', 'a'])) // 已删的/重复的忽略
ok(() => assert.deepEqual(ids(applyOrder(D('a', 'b', 'c', 'd'), ['c'])), ['c', 'a', 'b', 'd'])) // 新文档保持原相对顺序
ok(() => assert.deepEqual(moveIndex(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']))
ok(() => assert.deepEqual(moveIndex(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']))
ok(() => assert.deepEqual(moveIndex(['a'], 0, 5), ['a']))
// 全量 a b c d e，当前组只看 b、d、e；把 e 挪到最前
ok(() => assert.deepEqual(reorderVisible(['a', 'b', 'c', 'd', 'e'], ['b', 'd', 'e'], 2, 0), ['a', 'e', 'c', 'b', 'd']))
ok(() => assert.deepEqual(reorderVisible(['a', 'b'], ['a', 'b'], 1, 1), ['a', 'b']))
console.log(`全部通过：${n} 项`)
