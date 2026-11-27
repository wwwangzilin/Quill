import assert from 'node:assert/strict'
import { shelfGroups, filterShelf, resolveGroup, inGroup, LONG_CHARS } from './src/core/shelfGroups.ts'
const D = (id, o = {}) => ({ id, title: id, createdAt: 0, updatedAt: 0, starred: false, ...o })
const docs = [D('a', { tags: ['小说', '科幻'], chars: 90000, starred: true }), D('b', { tags: ['小说'], chars: 100 }), D('c', { tags: ['随笔'] }), D('d', { chars: LONG_CHARS })]
let n = 0
const ok = (f) => { f(); n++ }
ok(() => assert.deepEqual(shelfGroups(docs).map((g) => [g.id, g.count]), [['all', 4], ['starred', 1], ['long', 2], ['tag:小说', 2], ['tag:科幻', 1], ['tag:随笔', 1]]))
ok(() => assert.deepEqual(shelfGroups([D('x')]).map((g) => g.id), ['all'])) // 空组不列
ok(() => assert.deepEqual(filterShelf(docs, 'tag:小说').map((d) => d.id), ['a', 'b']))
ok(() => assert.deepEqual(filterShelf(docs, 'long').map((d) => d.id), ['a', 'd']))
ok(() => assert.equal(filterShelf(docs, 'all'), docs))
ok(() => assert.equal(inGroup(D('z', { tags: undefined }), 'tag:x'), false))
ok(() => assert.equal(resolveGroup(shelfGroups(docs), 'tag:没了'), 'all'))
ok(() => assert.equal(resolveGroup(shelfGroups(docs), 'starred'), 'starred'))
ok(() => { const many = Array.from({ length: 12 }, (_, i) => D('d' + i, { tags: ['t' + i] })); assert.equal(shelfGroups(many).filter((g) => g.id.startsWith('tag:')).length, 8) })
ok(() => assert.deepEqual(shelfGroups([D('a', { tags: ['x', 'x'] })]).find((g) => g.id === 'tag:x').count, 1)) // 同篇重复标签只算一次
console.log(`全部通过：${n} 项`)
