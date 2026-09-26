/**
 * Markdown 语法提示。
 *
 * 在行首敲下 `#`、或者打出 `**` 的时候，编辑器会在光标后面浮一个小标签，
 * 告诉你「这是干什么的」；鼠标移上去还能展开看效果示例 —— 不用翻说明文档，
 * 也不用把 Markdown 的写法全背下来。
 *
 * 这里只负责「认出光标前正在打的是哪个语法」，浮层交给 SyntaxHint 组件。
 */

/** 展开卡片里那行示例效果怎么画 */
export type SampleStyle =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'mark'
  | 'code'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'quote'
  | 'bullet'
  | 'number'
  | 'todo'
  | 'table'
  | 'hr'

export interface SyntaxItem {
  /** Markdown 里的写法 */
  token: string
  /** 浮在光标后面的短标签 */
  label: string
  /** 展开后的一句话说明 */
  detail: string
  /** 示例的写法那一半 */
  sampleIn: string
  /** 示例的效果那一半（由 sampleStyle 决定怎么渲染） */
  sampleOut: string
  sampleStyle: SampleStyle
  /** 只在段首才算数的块级语法 */
  block?: boolean
  /** 变长写法（`1.`、``` ``` ```）用自定义判定 */
  test?: (before: string) => boolean
}

/**
 * 语法清单。**顺序即优先级** —— 长的写法必须排在前面，
 * 否则 `**` 会被 `*`、`######` 会被 `#` 抢先认领。
 */
export const SYNTAX_ITEMS: SyntaxItem[] = [
  /* ===== 块级：写在段首，按到空格才成形 ===== */
  {
    token: '###### ',
    label: '六级标题',
    block: true,
    detail: '行首六个井号加空格，正文里最小的一级标题。',
    sampleIn: '###### 小结',
    sampleOut: '小结',
    sampleStyle: 'h6',
  },
  {
    token: '##### ',
    label: '五级标题',
    block: true,
    detail: '行首五个井号加空格。',
    sampleIn: '##### 小结',
    sampleOut: '小结',
    sampleStyle: 'h5',
  },
  {
    token: '#### ',
    label: '四级标题',
    block: true,
    detail: '行首四个井号加空格。',
    sampleIn: '#### 小结',
    sampleOut: '小结',
    sampleStyle: 'h4',
  },
  {
    token: '### ',
    label: '三级标题',
    block: true,
    detail: '行首三个井号加空格，适合小节。',
    sampleIn: '### 小结',
    sampleOut: '小结',
    sampleStyle: 'h3',
  },
  {
    token: '## ',
    label: '二级标题',
    block: true,
    detail: '行首两个井号加空格。',
    sampleIn: '## 第二章',
    sampleOut: '第二章',
    sampleStyle: 'h2',
  },
  {
    token: '# ',
    label: '一级标题',
    block: true,
    detail: '行首一个井号加空格，这篇里最大的标题。',
    sampleIn: '# 第一章',
    sampleOut: '第一章',
    sampleStyle: 'h1',
  },
  {
    token: '> ',
    label: '引用',
    block: true,
    detail: '行首大于号加空格，整段变成引用块；连按两次回车可以退出引用。',
    sampleIn: '> 他说的',
    sampleOut: '他说的',
    sampleStyle: 'quote',
  },
  {
    token: '- [ ] ',
    label: '待办',
    block: true,
    test: (b) => /^-\s\[[ xX]?\]\s?$/.test(b),
    detail: '减号、方括号、空格 —— 转为可点击勾选的待办项。',
    sampleIn: '- [ ] 待办事项',
    sampleOut: '待办事项',
    sampleStyle: 'todo',
  },
  {
    token: '- ',
    label: '无序列表',
    block: true,
    detail: '行首减号加空格，转为圆点列表；按 Tab 缩进为子项。',
    sampleIn: '- 一个要点',
    sampleOut: '一个要点',
    sampleStyle: 'bullet',
  },
  {
    token: '1. ',
    label: '有序列表',
    block: true,
    test: (b) => /^\d+\.\s$/.test(b),
    detail: '行首数字、点、空格 —— 回车后自动续接编号。',
    sampleIn: '1. 第一步',
    sampleOut: '第一步',
    sampleStyle: 'number',
  },
  {
    token: '```',
    label: '代码块',
    block: true,
    test: (b) => /^```/.test(b),
    detail: '三个反引号另起一行，后面可以跟语言名（如 ```js）做语法高亮。',
    sampleIn: '```js',
    sampleOut: '一段代码',
    sampleStyle: 'code',
  },
  {
    token: '---',
    label: '分隔线',
    block: true,
    test: (b) => /^-{3,}$/.test(b),
    detail: '三个减号独占一行，画一条横线把内容分开。',
    sampleIn: '---',
    sampleOut: '一条横线',
    sampleStyle: 'hr',
  },
  {
    token: '| ',
    label: '表格',
    block: true,
    test: (b) => /^\|/.test(b),
    detail: '竖线分隔单元格，第一行是表头，第二行写 |---|---| 定好列数。',
    sampleIn: '| 列 | 列 |',
    sampleOut: '两列表格',
    sampleStyle: 'table',
  },

  /* ===== 行内：写在文字两侧 ===== */
  {
    token: '**',
    label: '加粗',
    detail: '两侧各两个星号，中间的文字变粗。',
    sampleIn: '**重要**',
    sampleOut: '重要',
    sampleStyle: 'bold',
  },
  {
    token: '~~',
    label: '删除线',
    detail: '两侧各两个波浪号，文字上会划一道横线。',
    sampleIn: '~~删掉~~',
    sampleOut: '删掉',
    sampleStyle: 'strike',
  },
  {
    token: '==',
    label: '高亮',
    detail: '两侧各两个等号，给文字加一层底色。',
    sampleIn: '==重点==',
    sampleOut: '重点',
    sampleStyle: 'mark',
  },
  {
    token: '`',
    label: '行内代码',
    detail: '两侧各一个反引号，文字换成等宽字体，适合夹在句子里的命令或字段名。',
    sampleIn: '`npm run dev`',
    sampleOut: 'npm run dev',
    sampleStyle: 'code',
  },
  {
    token: '*',
    label: '斜体',
    detail: '两侧各一个星号，文字倾斜显示。',
    sampleIn: '*强调*',
    sampleOut: '强调',
    sampleStyle: 'italic',
  },
]

/**
 * 光标前那一段文本，是不是正好停在某个语法上。
 *
 * 块级语法要求「整段就是它」（刚打完 `# ` 才提示，写了标题正文就不再打扰）；
 * 行内语法只看结尾，因为 `**` 本来就该出现在文字中间。
 */
export function detectSyntax(before: string): SyntaxItem | null {
  for (const item of SYNTAX_ITEMS) {
    if (item.test) {
      if (item.test(before)) return item
      continue
    }
    if (item.block) {
      // 空格还没敲下去也算 —— `#` 刚打出来就该有人告诉你它是什么
      if (before === item.token || before === item.token.trimEnd()) return item
      continue
    }
    if (before.endsWith(item.token)) return item
  }
  return null
}
