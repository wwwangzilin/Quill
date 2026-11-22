// 点按分区：每种布局下，点在页面各处该翻页还是切沉浸
import { tapAction } from './src/core/pageTurn.ts'
let ok = 0
function eq(name, got, want) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`✗ ${name}\n  期望: ${JSON.stringify(want)}\n  实际: ${JSON.stringify(got)}`)
    process.exit(1)
  }
  ok++
}
const row = (layout) => [0.05, 0.3, 0.5, 0.7, 0.95].map((x) => tapAction(x, layout))
eq('标准', row('standard'), ['prev', 'toggle', 'toggle', 'toggle', 'next'])
eq('右手：右侧一大片都是下一页', row('right'), ['prev', 'toggle', 'toggle', 'next', 'next'])
eq('左手：左侧一大片都是下一页', row('left'), ['next', 'next', 'toggle', 'toggle', 'prev'])
eq('两侧都下一页', row('both'), ['next', 'toggle', 'toggle', 'toggle', 'next'])
eq('关：怎么点都只是沉浸开关', row('off'), ['toggle', 'toggle', 'toggle', 'toggle', 'toggle'])
eq('边界值：0.22 不算左区，0.78 不算右区', [tapAction(0.22, 'standard'), tapAction(0.78, 'standard')], ['toggle', 'toggle'])
console.log(`全部通过：${ok} 项`)
