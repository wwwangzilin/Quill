import type { JSONContent } from '@tiptap/core'
import { relOf } from './asset.ts'

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
/** GFM 表格行：以 | 开头或结尾 */
const TABLE_ROW = /^\s*\|.*\|\s*$/
/** 调过尺寸的图片会写成 HTML 形式：<img src="..." alt="..." width="400"> */
const IMG_HTML = /^<img\s+([^>]*?)\/?>\s*$/i

/** 把 `src="a" alt='b' width=400` 这样的属性串拆成对象 */
function htmlAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return out
}
/** 分隔行：| --- | :--: | */
const TABLE_SEP = /^\s*\|?[\s:|-]*-[\s:|-]*\|[\s:|-]*$/

function indentOf(s: string): number {
  const m = s.match(/^[\t ]*/)
  return (m?.[0] ?? '').replace(/\t/g, '  ').length
}

/* ----------------------------- 表格 ----------------------------- */

/** 拆一行表格单元格（`\|` 是转义出来的竖线，不能当分隔符） */
function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((s) => s.replace(/\\\|/g, '|').trim())
}

function cellNode(type: 'tableCell' | 'tableHeader', text: string): JSONContent {
  return {
    type,
    attrs: { colspan: 1, rowspan: 1, colwidth: null },
    content: [{ type: 'paragraph', content: inline(text) }],
  }
}

function parseTable(lines: string[], start: number): { node: JSONContent; end: number } {
  const head = splitCells(lines[start])
  const rows: string[][] = []
  let i = start + 2 // 跳过表头和分隔行
  while (i < lines.length && TABLE_ROW.test(lines[i])) {
    rows.push(splitCells(lines[i]))
    i += 1
  }
  const width = Math.max(head.length, ...rows.map((r) => r.length))
  const fill = (arr: string[]) => [...arr, ...Array(Math.max(0, width - arr.length)).fill('')]
  return {
    node: {
      type: 'table',
      content: [
        { type: 'tableRow', content: fill(head).map((t) => cellNode('tableHeader', t)) },
        ...rows.map((r) => ({
          type: 'tableRow',
          content: fill(r).map((t) => cellNode('tableCell', t)),
        })),
      ],
    },
    end: i,
  }
}

function isBlockStart(line: string): boolean {
  return (
    HEADING.test(line) ||
    QUOTE.test(line) ||
    LIST.test(line) ||
    FENCE.test(line) ||
    RULE.test(line) ||
    TABLE_ROW.test(line)
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

    // Setext 标题：正文行 + 下一行整行等号（H1）或减号（H2）。
    // 必须在 RULE 之前判断，否则「标题」加「---」会被拆成「段落 + 分隔线」，
    // 而 CommonMark 里那本来就是二级标题。
    if (
      i + 1 < lines.length &&
      !isBlockStart(line) &&
      !/^(?: {4}|\t)/.test(line) &&
      /^\s*(?:={2,}|-{2,})\s*$/.test(lines[i + 1])
    ) {
      out.push({
        type: 'heading',
        attrs: { level: /^\s*={2,}\s*$/.test(lines[i + 1]) ? 1 : 2 },
        content: inline(line.trim()),
      })
      i += 2
      continue
    }

    if (FENCE.test(line)) {
      // 围栏长度必须配对：用 ```` 开的块只能被 4 个及以上的反引号关掉。
      // 否则内容里只要出现 ``` 就会被当成结束标记，块被提前截断、内容直接坏掉。
      const open = /^\s*(`{3,}|~{3,})/.exec(line)
      const fenceChar = open ? open[1][0] : '`'
      const fenceLen = open ? open[1].length : 3
      const close = new RegExp(
        '^\\s*' + (fenceChar === '`' ? '`' : '~') + '{' + fenceLen + ',}\\s*$',
      )
      const lang = line.replace(/^\s*(?:`{3,}|~{3,})/, '').trim()
      const buf: string[] = []
      i += 1
      while (i < lines.length && !close.test(lines[i])) {
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
    //
    // 这里必须用 relOf 而不是 assetUrl：读进来的 src 得是仓库相对路径，
    // 因为编辑器里改了什么最终会原样写回 .md —— 换成 asset:// 等于把本机绝对路径
    // 腌进用户的文档，换台机器全废。relOf 顺带兜底：万一 .md 已经被写脏过也能还原。
    const img = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/)
    if (img) {
      out.push({
        type: 'image',
        attrs: { src: relOf(img[2]), alt: img[1] || null, title: null, width: null },
      })
      i += 1
      continue
    }

    // 调过尺寸的图片是 HTML 形式：整行 <img src="..." alt="..." width="400">
    const imgHtml = line.match(IMG_HTML)
    if (imgHtml) {
      const a = htmlAttrs(imgHtml[1])
      if (a.src) {
        const w = Number(a.width)
        out.push({
          type: 'image',
          attrs: {
            src: relOf(a.src),
            alt: a.alt || null,
            title: null,
            width: Number.isFinite(w) && w > 0 ? Math.round(w) : null,
          },
        })
        i += 1
        continue
      }
    }

    // 视频：整行 <video src="..."></video>
    const vid = line.match(/^<video\s+[^>]*src="([^"]+)"[^>]*>\s*<\/video>\s*$/i)
    if (vid) {
      out.push({ type: 'video', attrs: { src: relOf(vid[1]), title: null } })
      i += 1
      continue
    }

    // GFM 表格：表头行 + 分隔行 + 若干数据行
    if (TABLE_ROW.test(line) && TABLE_SEP.test(lines[i + 1] ?? '')) {
      const { node, end } = parseTable(lines, i)
      out.push(node)
      i = end
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      out.push({
        type: 'heading',
        attrs: { level: Math.min(6, heading[1].length) },
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

    // 缩进式代码块：CommonMark 的另一种写法，4 个空格或 1 个制表符。
    // 必须排在 LIST 之后判断，否则「缩进的列表项」会被误当成代码。
    if (/^(?: {4}|\t)/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^(?: {4}|\t)/.test(lines[i])) {
        buf.push(lines[i].replace(/^(?: {4}|\t)/, ''))
        i += 1
      }
      out.push({
        type: 'codeBlock',
        attrs: { language: null },
        content: buf.length ? [{ type: 'text', text: buf.join('\n') }] : [],
      })
      continue
    }

    const buf: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isBlockStart(lines[i]) &&
      !/^(?: {4}|\t)/.test(lines[i])
    ) {
      buf.push(lines[i])
      i += 1
    }
    out.push({ type: 'paragraph', content: inline(buf.join('\n')) })
  }

  return out
}

/* ----------------------------- 入口 ----------------------------- */

/**
 * 拆出 YAML frontmatter。
 *
 * 以前这里是「剥掉就扔」——用户在 Obsidian / Hugo / Jekyll 里写的元数据，
 * 只要被 Quill 打开过一次保存，就永久消失。现在改成拆出来交给 frontmatter 节点
 * 原样保存、原样写回，正文照旧不受它影响。
 */
export function splitFrontmatter(md: string): { yaml: string | null; body: string } {
  if (!md.startsWith('---')) return { yaml: null, body: md }
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(md)
  if (!m) return { yaml: null, body: md }
  return { yaml: m[1], body: md.slice(m[0].length) }
}

/** 只要正文：标题识别等场景用不到元数据 */
export function stripFrontmatter(md: string): string {
  return splitFrontmatter(md).body
}

/** 文档首行的 H1 当作标题，正文里就不重复显示了 */
export function splitTitle(md: string): { title: string; body: string } {
  const text = stripFrontmatter(md)
  const m = text.match(/^\s*#\s+(.+?)\s*(?:\n|$)/)
  if (!m) return { title: '', body: text }
  return { title: m[1].trim(), body: text.slice(m[0].length) }
}

/** 正文 + 元数据 → 文档体 */
function bodyToDoc(body: string, yaml: string | null): JSONContent {
  const nodes = parseBlocks(body.replace(/\r\n?/g, '\n').split('\n'))
  // 元数据放在最前，且必须进文档 —— 不然保存一次就没了
  if (yaml !== null) nodes.unshift({ type: 'frontmatter', attrs: { yaml } })
  if (!nodes.length) nodes.push({ type: 'paragraph' })
  return { type: 'doc', content: nodes }
}

export function markdownToDoc(md: string): JSONContent {
  const { yaml, body } = splitFrontmatter(md)
  return bodyToDoc(body, yaml)
}

/**
 * 存储层读盘用的一次到位解析。
 *
 * 不要再写成 splitTitle + markdownToDoc 两步走：splitTitle 内部会剥掉 frontmatter，
 * 剥完再交给 markdownToDoc，元数据就永远没机会进文档 —— 打开一次保存一次，
 * 用户写的 tags / date / 模板变量就全没了。
 */
export function parseDocument(md: string): { title: string; doc: JSONContent } {
  const { yaml, body } = splitFrontmatter(md)
  const { title, body: rest } = splitTitle(body)
  return { title, doc: bodyToDoc(rest, yaml) }
}

export { indentOf }
