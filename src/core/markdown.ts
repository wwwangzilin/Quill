import type { JSONContent } from '@tiptap/core'
import { relOf } from './asset.ts'

/**
 * Tiptap JSON → Markdown
 * 文档以 .md 作为唯一真相源（便于 git 版本管理 / 通用阅读），所以序列化必须精准可控。
 */

const INDENT = '  '

/**
 * 图片 → Markdown。
 *
 * 没调过尺寸的走标准 `![](src)`，.md 保持干净；
 * 调过尺寸的降级成 `<img ... width="400">` —— Markdown 语法本身表达不了宽度，
 * 而 GFM 允许内联 HTML，别的编辑器也都认这种写法。
 */
function imageMarkdown(node: JSONContent): string {
  const src = relOf(String(node.attrs?.src ?? ''))
  const alt = String(node.attrs?.alt ?? '')
  if (!src) return ''
  const w = Number(node.attrs?.width)
  if (Number.isFinite(w) && w > 0) {
    return `<img src="${src}" alt="${alt}" width="${Math.round(w)}">`
  }
  return `![${alt}](${src})`
}

/** 行内节点 → markdown 片段 */
function inline(node: JSONContent): string {
  if (node.type === 'text') {
    let t = node.text ?? ''
    const marks = node.marks ?? []
    if (marks.some((m) => m.type === 'code')) t = '`' + t + '`'
    if (marks.some((m) => m.type === 'bold')) t = '**' + t + '**'
    if (marks.some((m) => m.type === 'italic')) t = '*' + t + '*'
    if (marks.some((m) => m.type === 'strike')) t = '~~' + t + '~~'
    if (marks.some((m) => m.type === 'highlight')) t = '==' + t + '=='
    const link = marks.find((m) => m.type === 'link')
    if (link) t = `[${t}](${String(link.attrs?.href ?? '')})`
    return t
  }
  if (node.type === 'hardBreak') return '\\\n'
  if (node.type === 'image') return imageMarkdown(node)
  return (node.content ?? []).map(inline).join('')
}

/** 块级节点 → markdown 片段（可能多行） */
function block(node: JSONContent, depth: number): string {
  const pad = INDENT.repeat(depth)
  switch (node.type) {
    case 'paragraph': {
      const t = inline(node)
      return depth > 0 && !t ? pad : t
    }
    case 'heading': {
      const lv = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)))
      return '#'.repeat(lv) + ' ' + inline(node)
    }
    case 'blockquote': {
      const kids = node.content ?? []
      // 嵌套引用要紧贴着上一块写：`> 外层` 换行 `> > 内层`。
      // 中间插空行的话，序列化出来会多一个空的 `>` 行，改一次文件就多一行。
      let inner = ''
      kids.forEach((c, idx) => {
        if (idx > 0) inner += c.type === 'blockquote' ? '\n' : '\n\n'
        inner += block(c, 0)
      })
      return inner
        .split('\n')
        .map((l) => (l ? '> ' + l : '>'))
        .join('\n')
    }
    case 'codeBlock': {
      const lang = String(node.attrs?.language ?? '')
      const code = (node.content ?? []).map((c) => c.text ?? '').join('')
      // 内容里若本身带围栏，自己就得用更长的围栏包起来（CommonMark 允许任意长度），
      // 不然写出去的 .md 会把代码块从中间截断。
      const runs = code.match(/`{3,}/g)
      const fence = runs
        ? '`'.repeat(Math.max(3, Math.max(...runs.map((r) => r.length)) + 1))
        : '```'
      return fence + lang + '\n' + code + '\n' + fence
    }
    case 'horizontalRule':
      return '---'
    case 'frontmatter': {
      // YAML 元数据原样写回，不参与正文排版
      const yaml = String(node.attrs?.yaml ?? '')
      return '---\n' + yaml + '\n---'
    }
    case 'table': {
      const rows = node.content ?? []
      if (!rows.length) return ''
      const cellText = (cell: JSONContent): string =>
        (cell.content ?? [])
          .map((c) => (c.type === 'paragraph' ? inline(c) : block(c, 0)))
          .join(' ')
          // 表格里没法放换行，竖线要转义，不然会把单元格切开
          .replace(/\|/g, '\\|')
          .replace(/\n+/g, ' ')
          .trim()
      const rowCells = (row: JSONContent) => (row.content ?? []).map(cellText)
      const head = rowCells(rows[0])
      const width = Math.max(head.length, ...rows.map((r) => (r.content ?? []).length), 1)
      const pad = (arr: string[]) => [...arr, ...Array(Math.max(0, width - arr.length)).fill('')]
      const lines = [
        `| ${pad(head).join(' | ')} |`,
        `| ${Array(width).fill('---').join(' | ')} |`,
        ...rows.slice(1).map((r) => `| ${pad(rowCells(r)).join(' | ')} |`),
      ]
      return lines.join('\n')
    }
    case 'image':
      return imageMarkdown(node)
    case 'video': {
      const src = relOf(String(node.attrs?.src ?? ''))
      return src ? `<video src="${src}" controls></video>` : ''
    }
    case 'bulletList':
      return listBlock(node, depth, () => '- ')
    case 'orderedList':
      return listBlock(node, depth, (i) => `${i + 1}. `)
    case 'taskList':
      return listBlock(node, depth, (i, item) => (item.attrs?.checked ? '- [x] ' : '- [ ] '))
    case 'listItem':
    case 'taskItem': {
      const head = (node.content ?? [])[0]
      return head ? block(head, depth) : ''
    }
    default: {
      const kids = node.content ?? []
      if (!kids.length) return ''
      return kids.map((c) => block(c, depth)).join('\n\n')
    }
  }
}

function listBlock(
  node: JSONContent,
  depth: number,
  marker: (index: number, item: JSONContent) => string,
): string {
  const items = node.content ?? []
  return items.map((item, i) => listItem(item, depth, marker(i, item))).join('\n')
}

function listItem(item: JSONContent, depth: number, marker: string): string {
  const pad = INDENT.repeat(depth)
  const kids = item.content ?? []
  const [head, ...tail] = kids
  const headLines = (head ? block(head, depth) : '').split('\n')
  const out: string[] = [pad + marker + (headLines[0] ?? '').trimStart()]
  for (const l of headLines.slice(1)) out.push(pad + INDENT + l)
  for (const t of tail) out.push(block(t, depth + 1))
  return out.join('\n')
}

/** 整篇文档 → markdown 全文 */
export function docToMarkdown(content: JSONContent | undefined, title?: string): string {
  const nodes = content?.content ?? []
  // frontmatter 必须待在文件最开头，且在标题之前 —— 只有第一行就是 --- 才会被认出来
  const fm = nodes.filter((n) => n.type === 'frontmatter')
  const rest = nodes.filter((n) => n.type !== 'frontmatter')
  const body = rest
    .map((n) => block(n, 0))
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
  const head = title && title.trim() ? `# ${title.trim()}\n\n` : ''
  const meta = fm.length ? fm.map((n) => block(n, 0)).join('\n') + '\n\n' : ''
  return meta + head + body + '\n'
}

/** 文件名安全化（Windows 非法字符 + 长度限制） */
export function safeFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  return cleaned || '未命名'
}
