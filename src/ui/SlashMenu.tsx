import type { Editor } from '@tiptap/core'

export interface SlashItem {
  id: string
  label: string
  hint: string
  glyph: string
  aliases: string[]
  run: (editor: Editor) => void
}

/** `/` 能唤起的块类型 —— 顺序即菜单顺序 */
export const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'text',
    label: '正文',
    hint: '普通段落',
    glyph: '¶',
    aliases: ['text', 'p', 'paragraph', '正文', '段落'],
    run: (e) => e.chain().focus().setParagraph().run(),
  },
  {
    id: 'h1',
    label: '一级标题',
    hint: '章节大标题',
    glyph: 'H1',
    aliases: ['h1', 'title', '标题', '一级'],
    run: (e) => e.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    label: '二级标题',
    hint: '小节标题',
    glyph: 'H2',
    aliases: ['h2', '标题', '二级'],
    run: (e) => e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: '三级标题',
    hint: '更小的分段',
    glyph: 'H3',
    aliases: ['h3', '标题', '三级'],
    run: (e) => e.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet',
    label: '无序列表',
    hint: '大纲的基本单位',
    glyph: '•',
    aliases: ['ul', 'bullet', 'list', '列表', '大纲'],
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'ordered',
    label: '有序列表',
    hint: '带编号的步骤',
    glyph: '1.',
    aliases: ['ol', 'ordered', 'number', '编号', '有序'],
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'task',
    label: '待办',
    hint: '可勾选的任务',
    glyph: '☑',
    aliases: ['todo', 'task', 'check', '待办', '任务'],
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'quote',
    label: '引用',
    hint: '摘录别人的话',
    glyph: '❝',
    aliases: ['quote', 'blockquote', '引用'],
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'code',
    label: '代码块',
    hint: '等宽块，可写代码',
    glyph: '{ }',
    aliases: ['code', 'pre', '代码'],
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'highlight',
    label: '高亮',
    hint: '给这段文字打标记',
    glyph: '▨',
    aliases: ['mark', 'highlight', '高亮', '标记'],
    run: (e) => e.chain().focus().toggleHighlight().run(),
  },
  {
    id: 'hr',
    label: '分割线',
    hint: '横向隔断',
    glyph: '—',
    aliases: ['hr', 'rule', 'divider', '分割', '分隔'],
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
]

export function filterSlash(query: string): SlashItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return SLASH_ITEMS
  return SLASH_ITEMS.filter(
    (i) => i.label.toLowerCase().includes(q) || i.aliases.some((a) => a.includes(q)),
  )
}

interface Props {
  items: SlashItem[]
  index: number
  x: number
  y: number
  onPick: (item: SlashItem) => void
}

export default function SlashMenu({ items, index, x, y, onPick }: Props) {
  if (!items.length) {
    return (
      <div className="slash-menu" style={{ left: x, top: y }}>
        <div className="slash-empty">没有匹配的块类型</div>
      </div>
    )
  }
  return (
    <div className="slash-menu" style={{ left: x, top: y }}>
      <div className="slash-head">插入块</div>
      {items.map((item, i) => (
        <button
          key={item.id}
          className={'slash-item' + (i === index ? ' on' : '')}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onPick(item)
          }}
        >
          <span className="glyph">{item.glyph}</span>
          <span className="label">{item.label}</span>
          <span className="hint">{item.hint}</span>
        </button>
      ))}
      <div className="slash-foot">↑↓ 选择 · Enter 确认 · Esc 关闭</div>
    </div>
  )
}
