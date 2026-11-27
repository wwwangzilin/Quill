import assert from 'node:assert/strict'
import { getBookStyle, setBookStyle, readBookMap, BOOK_STYLE_MAX } from './src/core/bookStyle.ts'
const mk = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) } }
let n = 0, ok = (name, f) => { f(); n++ }
ok('空表取到 null', () => assert.equal(getBookStyle(mk(), 'a.md'), null))
ok('写入再读出', () => { const s = mk(); setBookStyle(s, 'a.md', { size: 20 }); assert.deepEqual(getBookStyle(s, 'a.md'), { size: 20 }); assert.equal(getBookStyle(s, 'b.md'), null) })
ok('null 删除', () => { const s = mk(); setBookStyle(s, 'a.md', { size: 20 }); setBookStyle(s, 'a.md', null); assert.equal(getBookStyle(s, 'a.md'), null) })
ok('坏 JSON 不崩', () => { const s = mk(); s.setItem('quill-set:bookStyles', '{oops'); assert.deepEqual(readBookMap(s), {}) })
ok('数组当坏数据', () => { const s = mk(); s.setItem('quill-set:bookStyles', '[1]'); assert.deepEqual(readBookMap(s), {}) })
ok('超量丢最早的', () => { const s = mk(); for (let i = 0; i < BOOK_STYLE_MAX + 5; i++) setBookStyle(s, 'k' + i, { i }); const m = readBookMap(s); assert.equal(Object.keys(m).length, BOOK_STYLE_MAX); assert.ok(!('k0' in m)); assert.ok(('k' + (BOOK_STYLE_MAX + 4)) in m) })
ok('重写挪到最后', () => { const s = mk(); setBookStyle(s, 'a', 1); setBookStyle(s, 'b', 2); setBookStyle(s, 'a', 3); assert.deepEqual(Object.keys(readBookMap(s)), ['b', 'a']) })
console.log(`全部通过：${n} 项`)
