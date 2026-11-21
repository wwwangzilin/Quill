// 三方合并的往返断言
import { merge3, hasMarkers } from './src/core/merge3.ts'

let ok = 0
function eq(name, a, b) {
  if (a !== b) {
    console.error(`✗ ${name}\n  期望: ${JSON.stringify(b)}\n  实际: ${JSON.stringify(a)}`)
    process.exit(1)
  }
  ok++
  console.log(`  ✓ ${name}`)
}

const base = ['第一段', '第二段', '第三段', ''].join('\n')
const mine = ['第一段（本地改）', '第二段', '第三段', ''].join('\n')
const disk = ['第一段', '第二段', '第三段（磁盘改）', ''].join('\n')

console.log('互不冲突')
{
  const r = merge3(base, mine, disk)
  eq('两边不同段：零冲突', r.conflicts, 0)
  eq('合并结果取了两边的修改', r.merged, ['第一段（本地改）', '第二段', '第三段（磁盘改）', ''].join('\n'))
}

console.log('同一段冲突')
{
  const m = ['第一段（本地）', '第二段', '第三段', ''].join('\n')
  const d = ['第一段（磁盘）', '第二段', '第三段', ''].join('\n')
  const r = merge3(base, m, d)
  eq('同段修改算一处冲突', r.conflicts, 1)
  eq('冲突标记写进去了', hasMarkers(r.merged), true)
  eq('本地/磁盘两边都没丢', r.merged.includes('第一段（本地）') && r.merged.includes('第一段（磁盘）'), true)
}

console.log('单边修改')
{
  const r1 = merge3(base, mine, base)
  eq('只有本地改：直接采用', r1.merged, mine)
  eq('只有本地改：无冲突', r1.conflicts, 0)
  const r2 = merge3(base, base, disk)
  eq('只有磁盘改：直接采用', r2.merged, disk)
}

console.log('新增与删除')
{
  const m = ['第一段', '第二段', '本地新增', '第三段', ''].join('\n')
  const d = ['磁盘新增', '第一段', '第二段', '第三段', ''].join('\n')
  const r = merge3(base, m, d)
  eq('两处新增都能合进来', r.conflicts, 0)
  eq('合并后两行都在', r.merged.includes('本地新增') && r.merged.includes('磁盘新增'), true)

  const del = ['第一段', '第三段', ''].join('\n')
  const add = ['第一段', '第二段', '第三段', '第四段', ''].join('\n')
  // 删第三段的中段、另一边在末尾加一段：位置不相交，应该自动合上
  const r2 = merge3(base, del, add)
  eq('一边删中间、一边加末尾：不算冲突', r2.conflicts, 0)
  eq('删掉的没了、新加的还在', !r2.merged.includes('第二段') && r2.merged.includes('第四段'), true)
}

console.log('预览模式')
{
  const m = ['第一段（本地）', '第二段', '第三段', ''].join('\n')
  const d = ['第一段（磁盘）', '第二段', '第三段', ''].join('\n')
  const r = merge3(base, m, d, false)
  eq('不带标记时取本地版本', r.merged, m)
  eq('仍然报告冲突数', r.conflicts, 1)
}

console.log(`\n全部通过：${ok} 项`)
