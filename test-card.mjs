import assert from 'node:assert/strict'
import { wrapLines, layoutCard, CARD_W } from './src/core/excerptCard.ts'
const m = (s) => [...s].reduce((a, c) => a + (/[一-鿿，。]/.test(c) ? 10 : 5), 0) // 汉字 10，其他 5
let n = 0, ok = (f) => { f(); n++ }
ok(() => assert.deepEqual(wrapLines('一二三四五六', 30, m), ['一二三', '四五六']))
ok(() => assert.deepEqual(wrapLines('一二三，四五', 30, m), ['一二三，', '四五'])) // 避头
ok(() => assert.deepEqual(wrapLines('ab\n\ncd', 100, m), ['ab', '', 'cd']))
ok(() => assert.deepEqual(wrapLines('一 hello world', 60, m), ['一 hello', 'world']))
ok(() => { const l = wrapLines('x'.repeat(30), 50, m); assert.ok(l.every((s) => m(s) <= 50)); assert.equal(l.join(''), 'x'.repeat(30)) })
ok(() => assert.deepEqual(wrapLines('', 50, m), ['']))
ok(() => { const a = layoutCard({ quote: '短', note: '' }, m, m), b = layoutCard({ quote: '长'.repeat(200), note: '批' }, () => 100, () => 100); assert.ok(b.height > a.height); assert.equal(a.noteLines.length, 0); assert.ok(CARD_W === 1080) })
console.log(`全部通过：${n} 项`)
