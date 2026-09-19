// 核心逻辑自检：Markdown 序列化 + 文件名安全化（node 原生跑 TS，无需构建）
import { docToMarkdown, safeFileName } from './src/core/markdown.ts'
import { WELCOME } from './src/core/welcome.ts'

const md = docToMarkdown(WELCOME, '欢迎使用 Quill')
console.log('================ Markdown 输出 ================')
console.log(md)
console.log('================ 断言 ================')

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
]

let failed = 0
for (const [name, ok] of cases) {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}`)
  if (!ok) failed++
}
console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
