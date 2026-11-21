// 批注导出 Markdown + 颜色判断
import { commentsToMarkdown, isHiColor, HI_COLORS } from './src/core/comments.ts'
let ok = 0
function eq(name, got, want) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`✗ ${name}\n  期望: ${JSON.stringify(want)}\n  实际: ${JSON.stringify(got)}`)
    process.exit(1)
  }
  ok++
}
const md = commentsToMarkdown('月下潮声', [
  { id: 'a', quote: '他走到海边', note: '这里的节奏很好', created: 1, resolved: false, color: 'yellow' },
  { id: 'b', quote: '风很大\n潮声涌上来', note: '', created: 2, resolved: false },
])
eq('标题', md.split('\n')[0], '# 月下潮声 · 批注与高亮')
eq('有批注：引用 + 正文', md.includes('> 他走到海边\n\n这里的节奏很好'), true)
eq('纯高亮：只有引用，换行压成空格', md.includes('> 风很大 潮声涌上来\n'), true)
eq('以单个换行结尾', md.endsWith('\n') && !md.endsWith('\n\n'), true)
eq('颜色判断', [isHiColor('pink'), isHiColor('red'), isHiColor(undefined)], [true, false, false])
eq('五种颜色', HI_COLORS.length, 5)
console.log(`全部通过：${ok} 项`)
