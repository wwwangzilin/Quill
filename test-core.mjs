// 核心逻辑自检：Markdown 序列化 + 文件名安全化（node 原生跑 TS，无需构建）
import { docToMarkdown, safeFileName } from './src/core/markdown.ts'
import { markdownToDoc } from './src/core/md-parse.ts'
import { WELCOME } from './src/core/welcome.ts'

const md = docToMarkdown(WELCOME, '欢迎使用 Quill')
console.log('================ Markdown 输出 ================')
console.log(md)
console.log('================ 断言 ================')

/* 表格往返：写出去的 .md 必须能原样读回来（这是我们唯一的质量底线） */
const tableMd = ['| 名称 | 数量 | 备注 |', '| --- | --- | --- |', '| 苹果 | 3 | 脆 |', '| 香蕉 | 5 | |'].join(
  '\n',
)
const tableBack = docToMarkdown(markdownToDoc(tableMd))
const tableJson = markdownToDoc(tableMd)
// 结构：doc → table → tableRow → tableCell → paragraph → text
const tableNode = tableJson.content?.[0]
const headRow = tableNode?.content?.[0]
const bodyRow = tableNode?.content?.[1]
const cellText = (row, i) => row?.content?.[i]?.content?.[0]?.content?.[0]?.text ?? ''

/* 代码块 + 竖线转义 */
const pipeMd = ['| a | b |', '| --- | --- |', '| x\\|y | z |'].join('\n')
const pipeBack = docToMarkdown(markdownToDoc(pipeMd))

const cases = [
  ['文档标题写成 H1', md.startsWith('# 欢迎使用 Quill')],
  ['二级标题', md.includes('## 先试试这几下')],
  ['无序列表项', md.includes('- 行首输入 - 加空格，直接变大纲')],
  ['嵌套列表缩进 2 空格', /\n {2}- 缩进出来的层级，就是导图里的分支/.test(md)],
  ['待办未完成', md.includes('- [ ] Tauri 桌面壳')],
  ['待办已完成', md.includes('- [x] 沉浸写作')],
  ['引用块', md.includes('> 写不动的时候')],
  ['段落间空行', md.includes('\n\n')],
  ['文件名安全化', safeFileName('a/b:c*d?e"f<g>h|i') === 'a_b_c_d_e_f_g_h_i'],
  ['空标题回退', safeFileName('   ') === '未命名'],
  // 表格
  ['表格：首行是 tableHeader', headRow?.content?.[0]?.type === 'tableHeader'],
  ['表格：单元格文本正确', cellText(headRow, 0) === '名称' && cellText(headRow, 1) === '数量'],
  ['表格：第二行是普通单元格', bodyRow?.content?.[0]?.type === 'tableCell'],
  ['表格：往返后仍含分隔行', tableBack.includes('| --- | --- | --- |')],
  ['表格：往返后数据行还在', tableBack.includes('| 苹果 | 3 | 脆 |')],
  ['表格：竖线被转义', pipeBack.includes('x\\|y')],
  ['表格：空单元格补位', tableBack.includes('| 香蕉 | 5 |  |')],
  // 代码块（语法高亮之后仍要能往返）
  ['代码块语言保留', docToMarkdown(markdownToDoc('```js\nlet a = 1\n```')).includes('```js')],
]

let failed = 0
for (const [name, ok] of cases) {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}`)
  if (!ok) failed++
}
console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
