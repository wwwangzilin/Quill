import assert from 'node:assert/strict'
import { searchAnnots, splitByQuery, bookMarkdown, exportFiles } from './src/core/annotCenter.ts'
let n = 0
const ok = (f) => { f(); n++ }
const E = [
  { docId: 'a', docTitle: '斗破苍穹', comments: [{ id: 'c1', quote: '三十年河东', note: '伏笔：萧炎', created: 1e12 }, { id: 'c2', quote: '莫欺少年穷', note: '', created: 1e12 + 1 }], bookmarks: [{ id: 'b1', label: '第三章 · 第 2 屏', chapter: '第三章' }] },
  { docId: 'b', docTitle: '遮天', comments: [{ id: 'c3', quote: 'Dark Hour', note: '', created: 1e12 }], bookmarks: [] },
]
ok(() => { const r = searchAnnots(E, '伏笔'); assert.equal(r.total, 1); assert.equal(r.groups[0].docId, 'a'); assert.equal(r.groups[0].hits[0].id, 'c1') })
ok(() => { const r = searchAnnots(E, 'dark'); assert.equal(r.total, 1); assert.equal(r.groups[0].docId, 'b') }) // 大小写不敏感
ok(() => { const r = searchAnnots(E, '第三章'); assert.equal(r.groups[0].hits[0].kind, 'bookmark') })
ok(() => { const r = searchAnnots(E, '斗破'); assert.equal(r.total, 3) }) // 书名命中：整本书的批注+书签
ok(() => assert.equal(searchAnnots(E, '  ').total, 0))
ok(() => assert.equal(searchAnnots(E, '不存在').groups.length, 0))
ok(() => { const r = searchAnnots(E, '斗破', 2); assert.equal(r.total, 2); assert.equal(r.truncated, true) })
ok(() => assert.deepEqual(splitByQuery('abcABc', 'bc'), [{ t: 'a', hit: false }, { t: 'bc', hit: true }, { t: 'A', hit: false }, { t: 'Bc', hit: true }]))
ok(() => assert.deepEqual(splitByQuery('xyz', ''), [{ t: 'xyz', hit: false }]))
ok(() => {
  const md = bookMarkdown(E[0], { c1: { due: 1e12 + 86400000 * 3, ivl: 3, ease: 2.5, reps: 2 } }, 1e12)
  assert.ok(md.startsWith('# 《斗破苍穹》· 批注与书签'))
  assert.ok(md.includes('> 三十年河东') && md.includes('伏笔：萧炎'))
  assert.ok(md.includes('下次复习') && md.includes('未复习')) // c1 有状态，c2 没有
  assert.ok(md.includes('## 书签') && md.includes('- 第三章 · 第 2 屏'))
  assert.ok(md.indexOf('三十年') < md.indexOf('莫欺')) // 按创建时间
})
ok(() => {
  const dup = [E[0], { ...E[0], docId: 'z' }, { docId: 'e', docTitle: '空', comments: [], bookmarks: [] }]
  const f = exportFiles(dup, () => ({}))
  assert.deepEqual(f.map((x) => x.name), ['斗破苍穹.md', '斗破苍穹-2.md']) // 空书不导出、同名加序号
  assert.ok(f[0].data.length > 50)
})
console.log(`全部通过：${n} 项`)
