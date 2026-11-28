import assert from 'node:assert/strict'
import { filterToc, readPercent, firstUnread } from './src/core/readMarks.ts'
let n = 0
const ok = (f) => { f(); n++ }
const T = ['序章', '第一章 初入江湖', '第二章 Chapter Two', '第三章 归来']
ok(() => assert.deepEqual(filterToc(T, ''), [0, 1, 2, 3]))
ok(() => assert.deepEqual(filterToc(T, '归来'), [3]))
ok(() => assert.deepEqual(filterToc(T, 'chapter'), [2])) // 不区分大小写
ok(() => assert.deepEqual(filterToc(T, '3'), [2])) // 纯数字当序号：第 3 章 = 下标 2
ok(() => assert.deepEqual(filterToc(['第3章', 'x', 'y'], '3'), [0, 2])) // 标题含 3 的 + 序号 3 的，都留着
ok(() => assert.deepEqual(filterToc(T, '不存在'), []))
ok(() => assert.equal(readPercent(new Set(['序章', '第一章 初入江湖']), T), 50))
ok(() => assert.equal(readPercent(new Set(), []), 0))
ok(() => assert.equal(firstUnread(new Set(['序章', '第一章 初入江湖']), T), 2))
ok(() => assert.equal(firstUnread(new Set(T), T), -1))
console.log(`全部通过：${n} 项`)
