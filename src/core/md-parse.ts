import type { JSONContent } from '@tiptap/core'
import { assetUrl } from './asset.ts'

/**
 * Markdown → Tiptap JSON。
 *
 * 刻意与 core/markdown.ts 的序列化器**严格对称**：我们写出去的格式必须能原样读回来。
 * 手写而不用 markdown-it，是为了零依赖 + 往返可控；同时尽量兼容常见写法
 * （`*`/`+` 列表、`1)` 编号、`_斜体_` 之类）。
 */

interface ListLine {
  indent: number
  ordered: boolean
  task: boolean | null
  text: string
}

interface ItemNode {
  line: ListLine
  children: ItemNode[]
}

const FENCE = /^\s*(```|~~~)/
const HEADING = /^(#{1,6})\s+(.*)$/
const QUOTE = /^\s*>\s?/
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/

function indentOf(s: string): number {
  const m = s.match(/^[\t ]*/)
  return (m?.[0] ?? '').replace(/\t/g, '  ').length
}

function isBlockStart(line: string): boolean {
  return (
    HEADING.test(line) || QUOTE.test(line) || LIST.test(line) || FENCE.test(line) || RULE.test(line)
  )
}

/* ----------------------------- 行内 ----------------------------- */

const INLINE_TOKEN =
  /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|__[^_\n]+__|_[^_\n]+_|~~[^~\n]+~~|`[^`\n]+`|==[^=\n]+==|\[[^\]\n]+\]\([^)\n]+\))/

type Mark = { type: string; attrs?: Record<string, unknown> }

function mark(type: string): Mark {
  return { type }
}

function inline(text: string): JSONContent[] {
  if (!text) return []
  const out: JSONContent[] = []
  for (const part of text.split(INLINE_TOKEN)) {
    if (!part) continue
    let m: RegExpMatchArray | null
    if ((m = part.match(/^\*\*([^*]+)\*\*$/)) || (m = part.match(/^__([^_]+)__$/))) {
      out.push({ type: 'text', text: m[1], marks: [mark('bold')] })
    } else if ((m = part.match(/^\*([^*]+)\*$/)) || (m = part.match(/^_([^_]+)_$/))) {
      out.push({ type: 'text', text: m[1], marks: [mark('italic')] })
    } else if ((m = part.match(/^~~([^~]+)~~$/))) {
      out.push({ type: 'text', text: m[1], marks: [mark('strike')] })
    } else if ((m = part.match(/^`([^`]+)`$/))) {
      out.push({ type: 'text', text: m[1], marks: [mark('code')] })
    } else if ((m = part.match(/^==([^=]+)==$/))) {
      out.push({ type: 'text', text: m[1], marks: [mark('highlight')] })
    } else if ((m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/))) {
      out.push({ type: 'text', text: m[1], marks: [{ type: 'link', attrs: { href: m[2] } }] })
    } else {
      out.push({ type: 'text', text: part })
    }
  }
  return out
}

/* ----------------------------- 列表 ----------------------------- */

function collectListLines(lines: string[], start: number): { items: ListLine[]; end: number } {
  const items: ListLine[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      const next = lines[i + 1]
      if (next === undefined || !LIST.test(next)) break
      i += 1
      continue
    }
    const m = line.match(LIST)
    if (!m) break
    const rest = m[3]
    const taskMatch = rest.match(/^\[([ xX])\]\s*(.*)$/)
    items.push({
      indent: m[1].replace(/\t/g, '  ').length,
      ordered: /^\d/.test(m[2]),
      task: taskMatch ? taskMatch[1].toLowerCase() === 'x' : null,
      text: taskMatch ? taskMatch[2] : rest,
    })
    i += 1
  }
  return { items, end: i }
}

function buildForest(items: ListLine[]): ItemNode[] {
  const roots: ItemNode[] = []
  const stack: ItemNode[] = []
  for (const line of items) {
    const node: ItemNode = { line, children: [] }
    while (stack.length && stack[stack.length - 1].line.indent >= line.indent) stack.pop()
    if (stack.length) stack[stack.length - 1].children.push(node)
    else roots.push(node)
    stack.push(node)
  }
  return roots
}

type Kind = 'task' | 'ordered' | 'bullet'

function kindOf(line: ListLine): Kind {
  if (line.task !== null) return 'task'
  return line.ordered ? 'ordered' : 'bullet'
}

function forestToNodes(nodes: ItemNode[]): JSONContent[] {
  const out: JSONContent[] = []
  let i = 0
  while (i < nodes.length) {
    const kind = kindOf(nodes[i].line)
    let j = i
    while (j < nodes.length && kindOf(nodes[j].line) === kind) j += 1

    const type = kind === 'task' ? 'taskList' : kind === 'ordered' ? 'orderedList' : 'bulletList'
    out.push({
      type,
      content: nodes.slice(i, j).map((n) => {
        const body: JSONContent[] = [
          { type: 'paragraph', content: inline(n.line.text) },
          ...forestToNodes(n.children),
        ]
        if (kind === 'task') {
          return { type: 'taskItem', attrs: { checked: n.line.task === true }, content: body }
        }
        return { type: 'listItem', content: body }
      }),
    })
    i = j
  }
  return out
}

/* ----------------------------- 块级 ----------------------------- */

function parseBlocks(lines: string[]): JSONContent[] {
  const out: JSONContent[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i += 1
      continue
    }

    if (FENCE.test(line)) {
      const lang = line.replace(FENCE, '').trim()
      const buf: string[] = []
      i += 1
      while (i < lines.length && !FENCE.test(lines[i])) {
        buf.push(lines[i])
        i += 1
      }
      i += 1
      out.push({
        type: 'codeBlock',
        attrs: { language: lang || null },
        content: buf.length ? [{ type: 'text', text: buf.join('\n') }] : [],
      })
      continue
    }

    if (RULE.test(line)) {
      out.push({ type: 'horizontalRule' })
      i += 1
      continue
    }

    // 图片：整行 ![alt](src)
    const img = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/)
    if (img) {
      out.push({
        type: 'image',
        attrs: { src: assetUrl(img[2]), alt: img[1] || null, title: null },
      })
      i += 1
      continue
    }

    // 视频：整行 <video src="..."></video>
    const vid = line.match(/^<video\s+[^>]*src="([^"]+)"[^>]*>\s*<\/video>\s*$/i)
    if (vid) {
      out.push({ type: 'video', attrs: { src: assetUrl(vid[1]), title: null } })
      i += 1
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      out.push({
        type: 'heading',
        attrs: { level: Math.min(3, heading[1].length) },
        content: inline(heading[2]),
      })
      i += 1
      continue
    }

    if (QUOTE.test(line)) {
      const buf: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        buf.push(lines[i].replace(QUOTE, ''))
        i += 1
      }
      out.push({ type: 'blockquote', content: parseBlocks(buf) })
      continue
    }

    if (LIST.test(line)) {
      const { items, end } = collectListLines(lines, i)
      out.push(...forestToNodes(buildForest(items)))
      i = end
      continue
    }

    const buf: string[] = []
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      buf.push(lines[i])
      i += 1
    }
    out.push({ type: 'paragraph', content: inline(buf.join('\n')) })
  }

  return out
}

/* ----------------------------- 入口 ----------------------------- */

/** 去掉 YAML frontmatter（外部编辑器可能加），返回正文 */
export function stripFrontmatter(md: string): string {
  if (!md.startsWith('---')) return md
  const end = md.indexOf('\n---', 3)
  if (end === -1) return md
  const after = md.indexOf('\n', end + 1)
  return after === -1 ? '' : md.slice(after + 1)
}

/** 文档首行的 H1 当作标题，正文里就不重复显示了 */
export function splitTitle(md: string): { title: string; body: string } {
  const text = stripFrontmatter(md)
  const m = text.match(/^\s*#\s+(.+?)\s*(?:\n|$)/)
  if (!m) return { title: '', body: text }
  return { title: m[1].trim(), body: text.slice(m[0].length) }
}

export function markdownToDoc(md: string): JSONContent {
  const nodes = parseBlocks(stripFrontmatter(md).replace(/\r\n?/g, '\n').split('\n'))
  if (!nodes.length) nodes.push({ type: 'paragraph' })
  return { type: 'doc', content: nodes }
}

export { indentOf }
