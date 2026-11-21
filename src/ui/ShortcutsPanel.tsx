import { hintOf } from '../core/shortcuts'

interface Props {
  open: boolean
  onClose: () => void
}

/* 应用级快捷键的文案**从清单里取**（core/shortcuts.ts）——
   散着写「Ctrl + W」的结果就是：改了键位忘了改这里，面板上写着有、按了没反应。 */
const K = {
  save: hintOf('save'),
  newDoc: hintOf('newDoc'),
  daily: hintOf('daily'),
  shortcuts: hintOf('shortcuts'),
  sidebar: hintOf('sidebar'),
  palette: hintOf('palette'),
  searchAll: hintOf('searchAll'),
  closeTab: hintOf('closeTab'),
  nextTab: hintOf('nextTab'),
  prevTab: hintOf('prevTab'),
  prevDoc: hintOf('prevDoc'),
  reading: hintOf('reading'),
  zen: hintOf('zen'),
}

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: '编辑',
    rows: [
      ['Ctrl + B', '加粗'],
      ['Ctrl + I', '斜体'],
      ['Ctrl + E', '行内代码'],
      ['Ctrl + Shift + X', '删除线'],
      ['Ctrl + Z / Ctrl + Shift + Z', '撤销 / 重做'],
      ['Ctrl + V', '粘贴截图 · 存入 assets/ 并插入为图片'],
    ],
  },
  {
    title: '大纲',
    rows: [
      ['- 空格', '转为无序列表'],
      ['1. 空格', '转为有序列表'],
      ['[] 空格', '转为待办项'],
      ['Tab / Shift + Tab', '缩进 / 退回一级'],
      ['点击行首三角', '折叠 / 展开'],
      ['/ 任意位置', '唤起块类型菜单'],
    ],
  },
  {
    title: '文档',
    rows: [
      [K.save, '立即保存；平时自动保存'],
      [K.newDoc, '新建文档'],
      [K.daily, '打开今天的日记，不存在则按「日记」模板新建'],
      ['选中文字 → ＋ 批注', '为选中文字添加批注 · 存于元数据，不写入正文'],
      [K.palette, '命令面板 / 全局搜索'],
      [K.searchAll, '全库搜索'],
      [K.shortcuts, '打开 / 关闭本面板'],
      [K.sidebar, '收起 / 展开侧栏'],
    ],
  },
  {
    title: '标签页',
    rows: [
      [K.nextTab, '下一个标签页'],
      [K.prevTab, '上一个标签页'],
      ['Ctrl + 1 … 9', '切换到第 N 个标签页'],
      [K.closeTab, '关闭当前标签页（会先确认能存下来）'],
      [K.prevDoc, '回到上一个用过的文档'],
      ['← / →', '在标签之间移动焦点（不切换文档）'],
      ['Enter / Delete', '打开聚焦的标签 / 关闭它'],
      ['右键标签', '关闭其他、关闭右侧、固定'],
    ],
  },
  {
    title: '视图',
    rows: [
      ['顶部「写作 / 导图」', '切换大纲与思维导图'],
      ['顶部 ◉', '专注模式：只亮当前段落'],
      ['顶部 ⇅', '打字机模式：光标锁定视口'],
      ['顶部 ⏱', '版本历史：预览与回滚'],
      [K.reading, '阅读模式：收起周边界面，正文只读'],
      [K.zen, '禅模式：全屏，仅保留正文'],
    ],
  },
  {
    title: '导入导出',
    rows: [
      ['⋯ 更多 → 导出 PDF', '走系统打印，打印机选「Microsoft Print to PDF」'],
      ['⋯ 更多 → 导出 HTML', '单文件、样式内联，便于直接分享'],
      ['⋯ 更多 → 导入文件夹', '导入整个 .md 文件夹（Obsidian / Notion 导出）'],
      ['⋯ 更多 → 导入文本文件', '.txt 自动识别编码（UTF-8 / GBK）并转为 Markdown'],
    ],
  },
]

export default function ShortcutsPanel({ open, onClose }: Props) {
  if (!open) return null
  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>快捷键</span>
          <button className="btn ghost icon" onClick={onClose} title="关闭">
            ×
          </button>
        </div>
        <div className="modal-body">
          {GROUPS.map((g) => (
            <div className="sc-group" key={g.title}>
              <div className="sc-title">{g.title}</div>
              {g.rows.map(([keys, text]) => (
                <div className="sc-row" key={keys}>
                  <span className="sc-keys">
                    {keys.split(' / ').map((k, i) => (
                      <span key={k}>
                        {i > 0 && <span className="sc-sep">/</span>}
                        <span className="kbd">{k}</span>
                      </span>
                    ))}
                  </span>
                  <span className="sc-text">{text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
