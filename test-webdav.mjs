import assert from 'node:assert/strict'
import { parseMeta, mergeMeta, metaDiff, metaEqual, emptyMeta, planAssets, isAssetName, parsePropfind, planSync, conflictName, sameText, isSyncName, dirUrl, fileUrl } from './src/core/webdav.ts'
let n = 0
const ok = (f) => { f(); n++ }
const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
<d:response><d:href>/dav/Quill/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
<d:response><d:href>/dav/Quill/%E6%9C%88%E4%B8%8B.md</d:href><d:propstat><d:prop><d:getcontentlength>1234</d:getcontentlength><d:getetag>"abc123"</d:getetag><d:getlastmodified>Sun, 22 Nov 2026 02:00:00 GMT</d:getlastmodified><d:resourcetype/></d:prop></d:propstat></d:response>
<D:response xmlns:D="DAV:"><D:href>https://h.example/dav/Quill/assets/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>
<d:response><d:href>/dav/Quill/a&amp;b.md</d:href><d:propstat><d:prop><d:getcontentlength>5</d:getcontentlength><d:getlastmodified>Mon, 01 Jan 2026 00:00:00 GMT</d:getlastmodified></d:prop></d:propstat></d:response>
</d:multistatus>`
const es = parsePropfind(xml, 'https://h.example/dav/Quill/')
ok(() => assert.deepEqual(es.map((e) => e.name), ['月下.md', 'assets', 'a&b.md']))
ok(() => assert.equal(es[0].tag, '"abc123"'))
ok(() => assert.deepEqual([es[0].size, es[1].isDir, es[0].isDir], [1234, true, false]))
ok(() => assert.equal(es[2].tag, '5|Mon, 01 Jan 2026 00:00:00 GMT')) // 没 etag 用 大小|修改时间
ok(() => assert.equal(parsePropfind('<x/>', 'https://h/').length, 0))

const L = (o) => new Map(Object.entries(o).map(([k, v]) => [k, { sig: v }]))
const R = (o) => new Map(Object.entries(o).map(([k, v]) => [k, { tag: v }]))
const plan = (l, r, b) => Object.fromEntries(planSync(L(l), R(r), b).map((p) => [p.name, p.op]))
ok(() => assert.deepEqual(plan({ a: '1' }, {}, {}), { a: 'push' }))
ok(() => assert.deepEqual(plan({}, { a: 't' }, {}), { a: 'pull' }))
ok(() => assert.deepEqual(plan({ a: '1' }, { a: 't' }, {}), { a: 'compare' })) // 第一次两边都有
ok(() => assert.deepEqual(plan({ a: '1' }, { a: 't' }, { a: { l: '1', r: 't' } }), { a: 'skip' }))
ok(() => assert.deepEqual(plan({ a: '2' }, { a: 't' }, { a: { l: '1', r: 't' } }), { a: 'push' }))
ok(() => assert.deepEqual(plan({ a: '1' }, { a: 't2' }, { a: { l: '1', r: 't' } }), { a: 'pull' }))
ok(() => assert.deepEqual(plan({ a: '2' }, { a: 't2' }, { a: { l: '1', r: 't' } }), { a: 'compare' }))
ok(() => assert.deepEqual(plan({ a: '1' }, {}, { a: { l: '1', r: 't' } }), { a: 'push' })) // 远端删了：补传而不是跟着删
ok(() => assert.deepEqual(plan({}, { a: 't' }, { a: { l: '1', r: 't' } }), { a: 'pull' })) // 本地删了：补回
ok(() => assert.deepEqual(Object.keys(plan({ b: '1', a: '1' }, { c: 't' }, {})), ['a', 'b', 'c']))
ok(() => assert.equal(conflictName('月下.md', new Date(2026, 10, 22, 9, 5)), '月下 (冲突 20261122-0905).md'))
ok(() => assert.equal(sameText('a\r\nb\n', 'a\nb'), true))
ok(() => assert.equal(sameText('a', 'b'), false))
ok(() => assert.deepEqual(['x.md', '.hidden.md', 'a/b.md', 'x.txt', 'X.MD'].map(isSyncName), [true, false, false, false, true]))
ok(() => assert.equal(dirUrl('https://h/dav'), 'https://h/dav/'))
ok(() => assert.equal(fileUrl('https://h/dav', '月 下#1.md'), 'https://h/dav/' + encodeURIComponent('月 下#1.md')))

// ---- 元数据合并 ----
const names = new Set(['a.md', 'b.md'])
const lm = { version: 1, starred: ['a.md'], tags: { 'a.md': ['小说'] }, comments: { 'a.md': [{ id: 'c1', quote: 'q', note: '', created: 1 }] } }
const rm = { version: 1, starred: ['b.md', 'gone.md'], tags: { 'a.md': ['科幻', '小说'], 'b.md': ['随笔'], 'gone.md': ['x'] }, comments: { 'a.md': [{ id: 'c1', quote: 'q', note: '', created: 1, resolved: true }, { id: 'c2', quote: 'q2', note: 'n', created: 2 }] } }
const mm = mergeMeta(lm, rm, names)
ok(() => assert.deepEqual(mm.starred, ['a.md', 'b.md'])) // gone.md 本地没有，不带
ok(() => assert.deepEqual(mm.tags, { 'a.md': ['小说', '科幻'], 'b.md': ['随笔'] }))
ok(() => assert.deepEqual(mm.comments['a.md'].map((c) => [c.id, !!c.resolved]), [['c1', true], ['c2', false]]))
const df = metaDiff(lm, mm)
ok(() => assert.deepEqual([df.star, Object.keys(df.tags), Object.keys(df.comments)], [['b.md'], ['a.md', 'b.md'], ['a.md']]))
ok(() => assert.deepEqual(metaDiff(mm, mm), { star: [], tags: {}, comments: {} })) // 合并后再比：无事可做
ok(() => assert.equal(metaEqual(mergeMeta(mm, mm, names), mm), true)) // 幂等
ok(() => assert.deepEqual(parseMeta('{坏的'), emptyMeta()))
ok(() => assert.deepEqual(parseMeta('{"starred":[1,"a.md"],"tags":{"a.md":"不是数组"},"comments":{"a.md":[{"id":1},{"id":"c","quote":"q","note":"","created":3}]}}').comments['a.md'].map((c) => c.id), ['c']))
ok(() => assert.deepEqual(parseMeta('{"starred":[1,"a.md"]}').starred, ['a.md']))
// ---- assets ----
const ap = planAssets([{ name: 'x.png', size: 10 }, { name: 'same.png', size: 5 }, { name: 'big.mp4', size: 99 * 1024 * 1024 }], [{ name: 'same.png', size: 5 }, { name: 'y.png', size: 7 }])
ok(() => assert.deepEqual([ap.push, ap.pull, ap.skipped.map((s) => s.name)], [['x.png'], ['y.png'], ['big.mp4']]))
ok(() => assert.deepEqual(['a.png', '.x', 'a/b', '..', 'a..b', ''].map(isAssetName), [true, false, false, false, false, false]))
console.log(`全部通过：${n} 项`)
