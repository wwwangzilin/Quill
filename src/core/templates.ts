import type { JSONContent } from '@tiptap/core'

export interface DocTemplate {
  id: string
  name: string
  hint: string
  glyph: string
  build: () => JSONContent
}

const p = (text: string): JSONContent => ({
  type: 'paragraph',
  content: text ? [{ type: 'text', text }] : undefined,
})

const h = (level: number, text: string): JSONContent => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
})

const li = (text: string, children?: JSONContent[]): JSONContent => ({
  type: 'listItem',
  content: [p(text), ...(children ? [{ type: 'bulletList', content: children }] : [])],
})

const task = (text: string, checked = false): JSONContent => ({
  type: 'taskItem',
  attrs: { checked },
  content: [p(text)],
})

const ul = (items: JSONContent[]): JSONContent => ({ type: 'bulletList', content: items })
const tasks = (items: JSONContent[]): JSONContent => ({ type: 'taskList', content: items })

const doc = (title: string, body: JSONContent[]): JSONContent => ({
  type: 'doc',
  content: [h(1, title), ...body],
})

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export const TEMPLATES: DocTemplate[] = [
  {
    id: 'blank',
    name: '空白文档',
    hint: '从零开始',
    glyph: '□',
    build: () => ({ type: 'doc', content: [{ type: 'paragraph' }] }),
  },
  {
    id: 'daily',
    name: '日记',
    hint: '今天发生了什么',
    glyph: '☀',
    build: () =>
      doc(today(), [
        h(2, '今天做了什么'),
        ul([li(''), li(''), li('')]),
        h(2, '想到的事'),
        ul([li('')]),
        h(2, '明天'),
        tasks([task(''), task('')]),
      ]),
  },
  {
    id: 'outline',
    name: '大纲草稿',
    hint: '先把骨架搭出来',
    glyph: '≡',
    build: () =>
      doc('未命名草稿', [
        h(2, '核心观点'),
        ul([li('一句话说清我要表达什么')]),
        h(2, '结构'),
        ul([
          li('第一部分', [li('要点'), li('要点')]),
          li('第二部分', [li('要点'), li('要点')]),
          li('第三部分', [li('要点')]),
        ]),
        h(2, '待补'),
        tasks([task('找资料'), task('补例子'), task('收尾')]),
      ]),
  },
  {
    id: 'reading',
    name: '读书笔记',
    hint: '书名 / 作者 / 摘录 / 感想',
    glyph: '❏',
    build: () =>
      doc('《书名》读书笔记', [
        ul([li('作者：'), li('读完时间：'), li('评分：')]),
        h(2, '一句话总结'),
        p(''),
        h(2, '摘录'),
        { type: 'blockquote', content: [p('')] },
        h(2, '我的想法'),
        ul([li(''), li('')]),
        h(2, '行动'),
        tasks([task('')]),
      ]),
  },
  {
    id: 'meeting',
    name: '会议记录',
    hint: '议题 / 结论 / 待办',
    glyph: '◎',
    build: () =>
      doc(`${today()} 会议记录`, [
        ul([li('参与人：'), li('议题：')]),
        h(2, '讨论要点'),
        ul([li('')]),
        h(2, '结论'),
        ul([li('')]),
        h(2, '待办'),
        tasks([task('（谁）做什么 —— 截止时间')]),
      ]),
  },
  {
    id: 'weekly',
    name: '周报',
    hint: '本周 / 下周 / 风险',
    glyph: '▤',
    build: () =>
      doc('周报', [
        h(2, '本周完成'),
        tasks([task(''), task('')]),
        h(2, '进行中'),
        ul([li('')]),
        h(2, '下周计划'),
        tasks([task('')]),
        h(2, '风险与需要支持'),
        ul([li('')]),
      ]),
  },
]
