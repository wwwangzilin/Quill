interface Props {
  open: boolean
  onClose: () => void
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
      ['Ctrl + V', '粘贴截图：直接存进 assets/ 并插成图片'],
    ],
  },
  {
    title: '大纲',
    rows: [
      ['- 空格', '变成无序列表'],
      ['1. 空格', '变成有序列表'],
      ['[] 空格', '变成待办'],
      ['Tab / Shift + Tab', '缩进 / 退回一级'],
      ['点击行首三角', '折叠 / 展开'],
      ['/ 任意位置', '唤起块类型菜单'],
    ],
  },
  {
    title: '文档',
    rows: [
      ['Ctrl + S', '立即保存（平时 0.65 秒自动保存）'],
      ['Ctrl + N', '新建文档'],
      ['Ctrl + D', '今天的日记（没有就按「日记」模板建）'],
      ['选中文字 → ＋ 批注', '给这段写条批注（存元数据，不进正文）'],
      ['Ctrl + /', '打开 / 关闭这个面板'],
      ['Ctrl + \\', '收起 / 展开侧栏'],
    ],
  },
  {
    title: '视图',
    rows: [
      ['顶部「写作 / 导图」', '切换大纲与思维导图'],
      ['顶部 ◉', '专注模式：只亮当前段落'],
      ['顶部 ⇅', '打字机模式：光标锁定视口'],
      ['顶部 ⏱', '版本历史：预览与回滚'],
      ['F9', '阅读模式：收起干扰、正文只读'],
    ],
  },
  {
    title: '导入导出',
    rows: [
      ['⋯ 更多 → 导出 PDF', '走系统打印，打印机选「Microsoft Print to PDF」'],
      ['⋯ 更多 → 导出 HTML', '单文件、样式内联，发出去别人直接能看'],
      ['⋯ 更多 → 导入文件夹', '把一整个 .md 文件夹搬进来（Obsidian / Notion 导出）'],
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
