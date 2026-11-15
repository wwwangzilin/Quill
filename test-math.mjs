// 公式与脚注：解析 → 序列化的往返（node 原生跑 TS）
import { markdownToDoc } from './src/core/md-parse.ts'
import { docToMarkdown } from './src/core/markdown.ts'

let ok = 0
function eq(name, input, expect = input) {
  const out = docToMarkdown(markdownToDoc(input))
  if (out.trim() !== expect.trim()) {
    console.error(`✗ ${name}\n  期望: ${JSON.stringify(expect)}\n  实际: ${JSON.stringify(out)}`)
    process.exit(1)
  }
  ok++
  console.log(`  ✓ ${name}`)
}

console.log('公式')
eq('行内公式原样往返', '质能方程 $E = mc^2$ 就是这样。')
eq('块级公式（单行）', '$$a^2 + b^2 = c^2$$')
eq('块级公式（多行）', '$$\n\\int_0^1 x^2 dx = \\frac{1}{3}\n$$')
eq('金额不当公式', '这个 $5 和 $10 都不是公式。')
eq('行内文字里的美元', '价格是 $3.50。')

console.log('脚注')
eq('引用 + 定义', '正文里有个说法[^1]。\n\n[^1]: 这是脚注的说明。')
eq('多个脚注', '甲[^a]，乙[^b]。\n\n[^a]: 第一个。\n\n[^b]: 第二个。')

console.log('混排')
eq(
  '公式与脚注一起',
  '公式 $x^2$ 加了脚注[^n]。\n\n$$\n\\sum_{i=1}^n i\n$$\n\n[^n]: 说明文字。',
)

console.log(`\n全部通过：${ok} 项`)
