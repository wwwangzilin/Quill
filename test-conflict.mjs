// 外部改动冲突：比对逻辑 + 错误识别的自检（node 原生跑 TS，无需构建）
import assert from 'node:assert/strict'
import { lineDiff } from './src/core/lineDiff.ts'
import { asSaveConflict, SaveConflictError } from './src/core/docGuard.ts'

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    console.error(`  ✗ ${name}`)
    throw err
  }
}

const kinds = (rows) => rows.map((r) => r.kind)
const textOf = (rows, kind) => rows.filter((r) => r.kind === kind).map((r) => r.text)

console.log('lineDiff')

check('两边一样时全是 same', () => {
  const rows = lineDiff('一\n二\n三', '一\n二\n三')
  assert.deepEqual(kinds(rows), ['same', 'same', 'same'])
})

check('改一行：同一位置给我的是 −、给磁盘的是 +', () => {
  const rows = lineDiff('一\n二\n三', '一\n二改\n三')
  assert.deepEqual(textOf(rows, 'mine'), ['二'])
  assert.deepEqual(textOf(rows, 'disk'), ['二改'])
})

check('只加一行：只出现 disk 那一行', () => {
  const rows = lineDiff('一\n三', '一\n二\n三')
  assert.deepEqual(textOf(rows, 'disk'), ['二'])
  assert.deepEqual(textOf(rows, 'mine'), [])
})

check('只删一行：只出现 mine 那一行', () => {
  const rows = lineDiff('一\n二\n三', '一\n三')
  assert.deepEqual(textOf(rows, 'mine'), ['二'])
  assert.deepEqual(textOf(rows, 'disk'), [])
})

check('长段未变中间折叠成一段 cut，不把原文全贴出来', () => {
  const base = Array.from({ length: 60 }, (_, i) => `第 ${i} 行`)
  const disk = [...base]
  disk[30] = '第 30 行（外部改过）'
  const rows = lineDiff(base.join('\n'), disk.join('\n'))
  assert.ok(rows.some((r) => r.kind === 'cut'), '应该有一段「… n 行未变 …」')
  assert.ok(rows.length < 20, `折叠后不该太长，实际 ${rows.length} 行`)
  assert.deepEqual(textOf(rows, 'disk'), ['第 30 行（外部改过）'])
})

check('差异紧挨着的地方不会被拆散（上下文各留 3 行）', () => {
  const base = Array.from({ length: 20 }, (_, i) => `l${i}`)
  const disk = [...base]
  disk[10] = 'changed'
  const rows = lineDiff(base.join('\n'), disk.join('\n'))
  const same = textOf(rows, 'same')
  assert.ok(same.includes('l7') && same.includes('l13'), '差异前后各三行要在')
  assert.ok(!same.includes('l0'), '远端未变内容应被折叠')
})

console.log('asSaveConflict')

check('能认出 Rust 抛上来的 { code, disk, digest } 对象', () => {
  const err = asSaveConflict({ code: 'conflict', message: '…', disk: '磁盘内容', digest: 7 })
  assert.ok(err instanceof SaveConflictError)
  assert.equal(err.code, 'conflict')
  assert.equal(err.disk, '磁盘内容')
  assert.equal(err.digest, 7)
})

check('deleted 也能认，且 disk 为 null', () => {
  const err = asSaveConflict({ code: 'deleted', message: '…' })
  assert.equal(err?.code, 'deleted')
  assert.equal(err?.disk, null)
})

check('普通错误不该被误认成冲突', () => {
  assert.equal(asSaveConflict('写入失败: 磁盘已满'), null)
  assert.equal(asSaveConflict(new Error('x')), null)
  assert.equal(asSaveConflict({ code: 'io', message: 'x' }), null)
  assert.equal(asSaveConflict(null), null)
})

check('SaveConflictError 原样透传（不会被包第二层）', () => {
  const one = new SaveConflictError('conflict', 'x', 3)
  assert.equal(asSaveConflict(one), one)
})

console.log(`\n全部通过：${passed} 项`)
