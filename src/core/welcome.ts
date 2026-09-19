import type { JSONContent } from '@tiptap/core'

/** 首次启动时生成的示例文档 —— 顺便当说明书 */
export const WELCOME: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '这是 Quill —— 一个把「想到哪写到哪」和「一眼看清结构」合在一起的写作工具。' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '先试试这几下' }],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '行首输入 - 加空格，直接变大纲；输入 1. 变编号' }] },
          ],
        },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '按 Tab 缩进一级，Shift+Tab 退回来——大纲就是这么长出来的' }] },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: '缩进出来的层级，就是导图里的分支' }] },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '输入 [] 加空格变待办，敲回车自动接着下一条' }] },
          ],
        },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '选中文字按 Ctrl+B 加粗、Ctrl+I 斜体、Ctrl+E 行内代码' }] },
          ],
        },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '点右上角「导图」，看看上面这棵树长什么样' }] },
          ],
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '还没做完的部分' }],
    },
    {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '沉浸写作 + 大纲缩进 + 待办' }] }],
        },
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '大纲一键转思维导图' }] }],
        },
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '本地存储 + Markdown / JSON 导出' }] }],
        },
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tauri 桌面壳：文档直存 .md 文件 + git 自动提交' }] }],
        },
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '大纲折叠 / 拖拽排序 / 专注模式' }] }],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '写不动的时候，先把想到的词丢成大纲，结构会自己浮出来。' }] },
      ],
    },
  ],
}
