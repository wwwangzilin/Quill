// 核心逻辑自检：Markdown 序列化 + 文件名安全化（node 原生跑 TS，无需构建）
import { docToMarkdown, safeFileName } from './src/core/markdown.ts'
import { markdownToDoc, splitTitle } from './src/core/md-parse.ts'
import { findIn, flatText, nodeText } from './src/core/comments.ts'

/**
 * 序列化用的测试夹具。
 *
 * 刻意自己写一份，**不拿欢迎文档当样本** —— 否则哪天改个欢迎文档那样的纯内容改动，
 * 就会莫名其妙弄挂一堆格式断言，让人以为序列化器坏了。
 * 欢迎文档本身另有 .verify/verify-welcome.mjs 专门验。
 */
const FIXTURE = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '二级标题' }] },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '顶层项' }] },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '嵌套项' }] }],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '未完成的事' }] }],
        },
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '已完成的事' }] }],
        },
      ],
    },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: '引用一句话' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: '第一段' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '第二段' }] },
  ],
}

const md = docToMarkdown(FIXTURE, '测试文档')
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

/*
 * 夹具往返：按真实链路走一遍。
 * 注意要先 splitTitle 把标题剥出来 —— 标题由文件名承载、不在正文里，
 * 直接拿整段 .md 去解析会把 H1 也当成正文内容，再序列化就多出一个 H1。
 */
const { title: backTitle, body: backBody } = splitTitle(md)
const backMd = docToMarkdown(markdownToDoc(backBody), backTitle)

const cases = [
  ['文档标题写成 H1', md.startsWith('# 测试文档')],
  ['二级标题', md.includes('## 二级标题')],
  ['无序列表项', /\n- 顶层项/.test(md)],
  ['嵌套列表缩进 2 空格', /\n {2}- 嵌套项/.test(md)],
  ['待办未完成', md.includes('- [ ] 未完成的事')],
  ['待办已完成', md.includes('- [x] 已完成的事')],
  ['引用块', md.includes('> 引用一句话')],
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
  // 夹具自己也要往返稳定：剥标题 → 解析 → 再序列化，结果不变
  ['夹具往返：按真实链路再序列化结果相同', backMd.trim() === md.trim()],
]

/*
 * 批注定位。
 *
 * 编辑器侧（ProseMirror 的 textIndex）和阅读视图侧（flatText）必须是**同一套口径**：
 * 都是把所有 text 节点直接接起来、不插任何分隔符。要是不一致，
 * 同一条批注就会出现「编辑器里看得见、进阅读视图就丢了」这种鬼事。
 * 这里锁住口径本身 + 那两种匹配策略。
 */
const ANNOT = [
  { type: 'paragraph', content: [{ type: 'text', text: '第一段有这句话。' }] },
  {
    type: 'paragraph',
    content: [
      { type: 'text', text: '第二段' },
      { type: 'hardBreak' },
      { type: 'text', text: '换行接着写' },
    ],
  },
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '标题' }] },
]
const flat = flatText(ANNOT)
const hit1 = findIn(flat, '有这句话')
const hit2 = findIn(flat, '第二段\n换行') // 精确匹配不到（flat 里没有换行符）→ 走「忽略空白」那条路
const hit3 = findIn(flat, '标题')

cases.push(
  ['批注：拍平后不含任何分隔符', flat === '第一段有这句话。第二段换行接着写标题'],
  ['批注：hardBreak 不占字符位', nodeText({ type: 'hardBreak' }) === ''],
  ['批注：定位到正确区间', hit1?.from === 3 && hit1?.to === 7],
  ['批注：原文改了换行也还找得到', hit2?.from === 8 && hit2?.to === 13],
  ['批注：落在文末也能定位', hit3?.from === 16 && hit3?.to === 18],
  ['批注：改没了的引文返回 null', findIn(flat, '这句根本不存在') === null],
  ['批注：空白引文不算数', findIn(flat, '   ') === null && findIn('', 'x') === null],
)

let failed = 0
for (const [name, ok] of cases) {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}`)
  if (!ok) failed++
}
console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
