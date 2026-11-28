import assert from 'node:assert/strict'
import { goalProgress, goalStreak } from './src/core/readGoal.ts'
import { parseTags, tagsText, tagCounts, filterByTag } from './src/core/annotTags.ts'
import { fingerprint, similarity, mostSimilar, FP_SIZE } from './src/core/fingerprint.ts'
import { readingCsv, CSV_HEADER } from './src/core/readingCsv.ts'
import { effectiveStatus, statusGroups, inStatusGroup, setStatus } from './src/core/shelfStatus.ts'
import { formatQuote } from './src/core/quoteFmt.ts'
import { isBigJump, pushSpot, popSpot } from './src/core/backSpot.ts'
let n = 0
const ok = (f) => { f(); n++ }

/* —— A 阅读目标 —— */
ok(() => assert.deepEqual(goalProgress(600, 30), { frac: 600 / 1800, done: false, leftMin: 20 }))
ok(() => assert.deepEqual(goalProgress(5000, 30), { frac: 1, done: true, leftMin: 0 }))
ok(() => assert.deepEqual(goalProgress(100, 0), { frac: 0, done: false, leftMin: 0 })) // 没设目标
ok(() => assert.equal(goalProgress(0, 30).leftMin, 30))
{
  const d = (y, m, dd) => new Date(y, m - 1, dd, 10).getTime()
  const key = (y, m, dd) => `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  const days = { [key(2026, 11, 25)]: { secs: 2000 }, [key(2026, 11, 26)]: { secs: 1900 }, [key(2026, 11, 27)]: { secs: 1800 } }
  ok(() => assert.equal(goalStreak(days, 30, d(2026, 11, 28)), 3)) // 今天没读：不断，从昨天数
  ok(() => assert.equal(goalStreak({ ...days, [key(2026, 11, 28)]: { secs: 1900 } }, 30, d(2026, 11, 28)), 4)) // 今天达标：算上
  ok(() => assert.equal(goalStreak({ ...days, [key(2026, 11, 27)]: { secs: 100 } }, 30, d(2026, 11, 28)), 0)) // 昨天没达标：断了
  ok(() => assert.equal(goalStreak(days, 0, d(2026, 11, 28)), 0))
  ok(() => assert.equal(goalStreak(days, 40, d(2026, 11, 28)), 0)) // 目标调高：之前的不算
}

/* —— B 标签 —— */
ok(() => assert.deepEqual(parseTags('伏笔, 金句；#待查  伏笔'), ['伏笔', '金句', '待查']))
ok(() => assert.deepEqual(parseTags('  '), []))
ok(() => assert.equal(parseTags('a b c d e f g h').length, 6)) // 最多 6 个
ok(() => assert.equal(parseTags('一二三四五六七八九十一二三四五')[0].length, 12)) // 限长
ok(() => assert.equal(tagsText(['a', 'b']), 'a b'))
{
  const L = [{ tags: ['伏笔', '金句'] }, { tags: ['伏笔'] }, {}, { tags: [] }]
  ok(() => assert.deepEqual(tagCounts(L), [{ tag: '伏笔', n: 2 }, { tag: '金句', n: 1 }]))
  ok(() => assert.equal(filterByTag(L, '伏笔').length, 2))
  ok(() => assert.equal(filterByTag(L, 'none').length, 2))
  ok(() => assert.equal(filterByTag(L, 'all').length, 4))
}

/* —— C 指纹 —— */
const rnd = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
const novel = (seed, len) => { const r = rnd(seed); let s = ''; while (s.length < len) s += String.fromCharCode(0x4e00 + Math.floor(r() * 3000)); return s }
{
  const A = novel(1, 60000)
  const B = novel(2, 60000)
  ok(() => assert.equal(fingerprint('太短').length, 0))
  ok(() => assert.equal(fingerprint(A).length, FP_SIZE))
  ok(() => assert.equal(similarity(fingerprint(A), fingerprint(A)), 1)) // 自己和自己
  ok(() => assert.ok(similarity(fingerprint(A), fingerprint(B)) < 0.1)) // 不相干
  // 同一本：排版不同（加换行/空格/标点），前面多了一段简介，后面少了一截
  const A2 = '简介：' + novel(9, 500) + '\n\n' + A.slice(0, 50000).replace(/(.{40})/g, '$1，\n ')
  ok(() => assert.ok(similarity(fingerprint(A), fingerprint(A2)) > 0.6, String(similarity(fingerprint(A), fingerprint(A2)))))
  ok(() => assert.equal(similarity([], fingerprint(A)), 0))
  ok(() => { const r = mostSimilar(fingerprint(A2), [{ id: 'b', fp: fingerprint(B) }, { id: 'a', fp: fingerprint(A) }]); assert.equal(r?.id, 'a') })
  ok(() => assert.equal(mostSimilar(fingerprint(A), [{ id: 'b', fp: fingerprint(B) }]), null))
}

/* —— D CSV —— */
ok(() => {
  const csv = readingCsv([{ title: '斗破,苍穹', chapter: '第一章', secs: 3600, first: new Date(2026, 10, 1, 9).getTime(), comments: 3, bookmarks: 1, status: '在读' }])
  assert.ok(csv.startsWith('﻿'))
  const lines = csv.trim().split('\r\n')
  assert.equal(lines[0].replace('﻿', ''), CSV_HEADER.join(','))
  assert.equal(lines[1], '"斗破,苍穹",在读,第一章,60,2026-11-01,,,3,1')
})
ok(() => assert.ok(readingCsv([{ title: '=HYPERLINK("x")', secs: 0, comments: 0, bookmarks: 0 }]).includes(`"'=HYPERLINK(""x"")"`))) // 公式注入 + 引号转义
ok(() => assert.ok(readingCsv([{ title: 'a"b', secs: 0, comments: 0, bookmarks: 0 }]).includes('"a""b"')))
ok(() => assert.equal(readingCsv([]).trim().split('\r\n').length, 1))

/* —— E 状态 —— */
ok(() => assert.equal(effectiveStatus(undefined, undefined), undefined))
ok(() => assert.equal(effectiveStatus(undefined, { secs: 10 }), 'reading'))
ok(() => assert.equal(effectiveStatus(undefined, { secs: 10, done: 5 }), 'done'))
ok(() => assert.equal(effectiveStatus('want', { secs: 10, done: 5 }), 'want')) // 手动优先
ok(() => assert.equal(effectiveStatus(undefined, { secs: 0 }), undefined))
ok(() => {
  const st = { a: 'reading', b: 'reading', c: 'done' }
  assert.deepEqual(statusGroups(['a', 'b', 'c', 'd'], (id) => st[id]), [{ id: 'st:reading', name: '在读', count: 2 }, { id: 'st:done', name: '读完', count: 1 }])
  assert.equal(inStatusGroup('st:done', 'done'), true); assert.equal(inStatusGroup('st:done', undefined), false)
})
ok(() => { const m = setStatus({}, 'a', 'want'); assert.deepEqual(m, { a: 'want' }); assert.deepEqual(setStatus(m, 'a', undefined), {}) })

/* —— G 引用 —— */
ok(() => assert.equal(formatQuote('  山高月小 ', { title: '书' }, 'plain'), '山高月小'))
ok(() => assert.equal(formatQuote('山高月小', { title: '斗破苍穹', chapter: '第一章' }, 'cite'), '「山高月小」——《斗破苍穹》· 第一章'))
ok(() => assert.equal(formatQuote('山高月小', { title: '书', chapter: '书' }, 'cite'), '「山高月小」——《书》')) // 章名=书名不重复
ok(() => assert.equal(formatQuote('山高月小', {}, 'cite'), '「山高月小」'))
ok(() => assert.equal(formatQuote('甲\n\n乙', { title: '书' }, 'md'), '> 甲\n>\n> 乙\n> —— 《书》'))
ok(() => assert.equal(formatQuote('   ', { title: '书' }, 'cite'), ''))

/* —— F 回到位置 —— */
ok(() => { assert.equal(isBigJump({ ci: 3, page: 5 }, { ci: 4, page: 0 }), false); assert.equal(isBigJump({ ci: 3, page: 5 }, { ci: 9, page: 0 }), true); assert.equal(isBigJump({ ci: 3, page: 5 }, { ci: 3, page: 7 }), false); assert.equal(isBigJump({ ci: 3, page: 5 }, { ci: 3, page: 9 }), true) })
ok(() => assert.deepEqual(pushSpot([], { ci: 1, page: 2 }), [{ ci: 1, page: 2 }]))
ok(() => assert.deepEqual(pushSpot([{ ci: 1, page: 2 }], { ci: 1, page: 2 }), [{ ci: 1, page: 2 }])) // 去重
ok(() => assert.equal(pushSpot(Array.from({ length: 5 }, (_, ci) => ({ ci, page: 0 })), { ci: 5, page: 0 }).length, 5)) // 上限
ok(() => assert.deepEqual(popSpot([{ ci: 1, page: 0 }, { ci: 3, page: 2 }]), { stack: [{ ci: 1, page: 0 }], spot: { ci: 3, page: 2 } }))
ok(() => assert.deepEqual(popSpot([]), { stack: [], spot: null }))
// quill-reading-features:multi-back-spot-tests
console.log(`全部通过：${n} 项`)

// ---- 导入查重 ----
{
  const { checkImports } = await import('./src/core/fingerprint.ts')
  const store = new Map()
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  const body = Array.from({ length: 80 }, (_, i) => `第${i}段：他走过长长的街道，天色渐渐暗下来，远处传来钟声${i * 7}。`).join('')
  const other = Array.from({ length: 80 }, (_, i) => `完全不同的故事${i}：海面上风平浪静，船员们正在甲板上整理缆绳与帆布${i * 13}。`).join('')
  assert.equal(checkImports([{ title: 'A', content: body }]).length, 0)
  const r = checkImports([{ title: 'A-副本', content: body }, { title: 'B', content: other }])
  assert.equal(r.length, 1); assert.equal(r[0].like, 'A')
  assert.equal(checkImports([{ title: '短', content: '很短' }]).length, 0)
  console.log('导入查重 ok')
}
