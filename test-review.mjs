import assert from 'node:assert/strict'
import { schedule, dueList, ivlLabel, NEW_CARD, dueAcross } from './src/core/review.ts'
const D = 86400000, t0 = 1e12
let n = 0
const ok = (f) => { f(); n++ }
ok(() => { const s = schedule(undefined, 'good', t0); assert.equal(s.ivl, 1); assert.equal(s.due, t0 + D) })
ok(() => { let s = schedule(undefined, 'good', t0); s = schedule(s, 'good', t0); assert.equal(s.ivl, 3) })
ok(() => { let s = undefined; for (let i = 0; i < 3; i++) s = schedule(s, 'good', t0); assert.equal(s.ivl, Math.round(3 * s.ease - 0 * 1) > 0 ? s.ivl : 0); assert.ok(s.ivl >= 7) })
ok(() => { const s = schedule({ due: 0, ivl: 10, ease: 2.5, reps: 4 }, 'again', t0); assert.equal(s.reps, 0); assert.equal(s.due, t0 + 600000); assert.ok(s.ease < 2.5) })
ok(() => { let s = NEW_CARD; for (let i = 0; i < 20; i++) s = schedule(s, 'again', t0); assert.ok(s.ease >= 1.3) })
ok(() => { let s = NEW_CARD; for (let i = 0; i < 40; i++) s = schedule(s, 'good', t0); assert.ok(s.ease <= 3) })
ok(() => { const s = schedule({ due: 0, ivl: 10, ease: 2.5, reps: 4 }, 'hazy', t0); assert.equal(s.ivl, 12); assert.ok(s.ease < 2.5) })
ok(() => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const st = { a: { due: t0 + D, ivl: 1, ease: 2.5, reps: 1 }, b: { due: t0 - 5, ivl: 1, ease: 2.5, reps: 1 }, c: { due: t0 - 100, ivl: 1, ease: 2.5, reps: 1 } }
  assert.deepEqual(dueList(items, st, t0).map((x) => x.id), ['c', 'b', 'd']) // a 未到期；新卡 d 最后
})
ok(() => { assert.equal(ivlLabel({ due: 0, ivl: 0, ease: 2, reps: 0 }), '10 分钟后'); assert.equal(ivlLabel({ due: 0, ivl: 1, ease: 2, reps: 1 }), '明天'); assert.equal(ivlLabel({ due: 0, ivl: 7, ease: 2, reps: 1 }), '7 天后') })
ok(() => {
  const docs = [
    { docId: 'A', docTitle: '甲', comments: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }] },
    { docId: 'B', docTitle: '乙', comments: [{ id: 'b1' }, { id: 'b2' }] },
  ]
  const st = { A: { a1: { due: t0 - 50, ivl: 1, ease: 2.5, reps: 1 } }, B: { b2: { due: t0 - 900, ivl: 1, ease: 2.5, reps: 1 } } }
  const q = dueAcross(docs, (d) => st[d] ?? {}, t0)
  // 到期的先（b2 最久，再 a1），新卡轮流：a2 b1 a3
  assert.deepEqual(q.map((x) => x.c.id), ['b2', 'a1', 'a2', 'b1', 'a3'])
  assert.equal(q[0].docTitle, '乙')
})
ok(() => assert.deepEqual(dueAcross([], () => ({}), t0), []))
console.log(`全部通过：${n} 项`)
