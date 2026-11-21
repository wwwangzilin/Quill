/**
 * EPUB → Markdown（一本书一篇文档，每章一个 `##`）。
 *
 * 不引任何依赖：
 *   · EPUB 就是 zip，自己读中央目录，deflate 交给浏览器自带的 DecompressionStream
 *     （WebView2 / WKWebView / Node 22 都有）；
 *   · container.xml / OPF / NCX 都是结构固定的小文件，用正则取就够了，
 *     这样纯 node 也能跑测试，不依赖 DOMParser。
 *
 * 只取文字：图片、样式、脚本一律丢掉。小说要的是正文，不是排版复刻。
 */

export interface EpubBook {
  title: string
  author: string
  chapters: { title: string; body: string }[]
}

/* ------------------------------ zip ------------------------------ */

interface ZipEntry {
  name: string
  method: number
  compSize: number
  localOffset: number
}

const u16 = (v: DataView, o: number) => v.getUint16(o, true)
const u32 = (v: DataView, o: number) => v.getUint32(o, true)

function listZip(buf: ArrayBuffer): Map<string, ZipEntry> {
  const v = new DataView(buf)
  // 末尾找 End Of Central Directory（签名 0x06054b50）；最多有 64K 的注释
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 65535); i -= 1) {
    if (u32(v, i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 EPUB（找不到 zip 目录）')
  const count = u16(v, eocd + 10)
  let p = u32(v, eocd + 16)
  const out = new Map<string, ZipEntry>()
  for (let n = 0; n < count; n += 1) {
    if (u32(v, p) !== 0x02014b50) break
    const method = u16(v, p + 10)
    const compSize = u32(v, p + 20)
    const nameLen = u16(v, p + 28)
    const extraLen = u16(v, p + 30)
    const commentLen = u16(v, p + 32)
    const localOffset = u32(v, p + 42)
    const raw = new Uint8Array(buf, p + 46, nameLen)
    // bit 11 = UTF-8 文件名；没标的老 epub 也基本是 UTF-8 / ASCII
    const name = new TextDecoder('utf-8').decode(raw)
    out.set(name, { name, method, compSize, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function readEntry(buf: ArrayBuffer, e: ZipEntry): Promise<Uint8Array> {
  const v = new DataView(buf)
  const nameLen = u16(v, e.localOffset + 26)
  const extraLen = u16(v, e.localOffset + 28)
  const start = e.localOffset + 30 + nameLen + extraLen
  const data = new Uint8Array(buf, start, e.compSize)
  if (e.method === 0) return data
  if (e.method !== 8) throw new Error(`不支持的压缩方式 ${e.method}`)
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Blob([data]).stream().pipeThrough(ds)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/* ------------------------------ 文本工具 ------------------------------ */

const utf8 = (b: Uint8Array) => new TextDecoder('utf-8').decode(b)

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, k: string) => {
    if (k[0] === '#') {
      const code = k[1].toLowerCase() === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m
    }
    return ENTITIES[k.toLowerCase()] ?? m
  })
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return m ? (m[2] ?? m[3] ?? '') : null
}

/** 相对路径按 base 目录解析（处理 ../ 和 ./） */
function resolve(base: string, href: string): string {
  const clean = decodeURIComponent(href.split('#')[0])
  const parts = (base ? base.split('/') : []).concat(clean.split('/'))
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p && p !== '.') out.push(p)
  }
  return out.join('/')
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** XHTML → { 首个标题, 段落文本 }；段落之间空一行 */
export function htmlToText(html: string): { heading: string; text: string } {
  let h = html
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|svg|head)[\s\S]*?<\/\1>/gi, '')
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(h)
  if (body) h = body[1]

  let heading = ''
  const hm = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/i.exec(h)
  if (hm) heading = decodeEntities(hm[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

  // 标题自己不进正文 —— 它会作为章名单独输出
  if (hm) h = h.replace(hm[0], '')

  h = h
    .replace(/<ruby[^>]*>([\s\S]*?)<\/ruby>/gi, (_, inner: string) =>
      // 注音只留本字：<rb>/<rt> 里 rt 是读音，不要
      inner.replace(/<rt[^>]*>[\s\S]*?<\/rt>/gi, '').replace(/<rp[^>]*>[\s\S]*?<\/rp>/gi, ''),
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|blockquote|h[1-6]|tr|section)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
  const text = decodeEntities(h)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t 　]+$/g, '').replace(/^[ \t 　]+/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { heading, text }
}

/* ------------------------------ EPUB ------------------------------ */

export async function parseEpub(buf: ArrayBuffer): Promise<EpubBook> {
  const zip = listZip(buf)
  const read = async (name: string) => {
    const e = zip.get(name)
    if (!e) return null
    return utf8(await readEntry(buf, e))
  }

  const container = await read('META-INF/container.xml')
  const opfPath = container ? attr(/<rootfile\b[^>]*>/i.exec(container)?.[0] ?? '', 'full-path') : null
  if (!opfPath) throw new Error('不是有效的 EPUB（缺少 container.xml）')
  const opf = await read(opfPath)
  if (!opf) throw new Error('不是有效的 EPUB（找不到 OPF）')
  const base = dirOf(opfPath)

  const title = decodeEntities(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1] ?? '').trim()
  const author = decodeEntities(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opf)?.[1] ?? '').trim()

  // manifest：id → href / properties
  const manifest = new Map<string, { href: string; props: string; type: string }>()
  for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = attr(m[0], 'id')
    const href = attr(m[0], 'href')
    if (id && href) {
      manifest.set(id, { href, props: attr(m[0], 'properties') ?? '', type: attr(m[0], 'media-type') ?? '' })
    }
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*>/gi)]
    .map((m) => attr(m[0], 'idref'))
    .filter((x): x is string => Boolean(x))

  // 目录里的章名（href → 标题）：EPUB3 的 nav，或 EPUB2 的 ncx
  const tocTitle = new Map<string, string>()
  const navItem = [...manifest.values()].find((m) => m.props.split(/\s+/).includes('nav'))
  const ncxItem = [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml')
  if (navItem) {
    const nav = await read(resolve(base, navItem.href))
    for (const m of nav?.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi) ?? []) {
      const href = attr(m[1], 'href')
      const label = decodeEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
      if (href && label) tocTitle.set(resolve(dirOf(resolve(base, navItem.href)), href), label)
    }
  }
  if (!tocTitle.size && ncxItem) {
    const ncx = await read(resolve(base, ncxItem.href))
    const ncxBase = dirOf(resolve(base, ncxItem.href))
    for (const m of ncx?.matchAll(/<navPoint\b[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\b([^>]*)\/?>/gi) ?? []) {
      const href = attr(m[2], 'src')
      const label = decodeEntities(m[1]).replace(/\s+/g, ' ').trim()
      if (href && label) tocTitle.set(resolve(ncxBase, href), label)
    }
  }

  const chapters: EpubBook['chapters'] = []
  for (const idref of spine) {
    const item = manifest.get(idref)
    if (!item || !/x?html/.test(item.type)) continue
    const path = resolve(base, item.href)
    const raw = await read(path)
    if (raw == null) continue
    const { heading, text } = htmlToText(raw)
    // 封面、版权页这类几乎没字的页不当章
    if (text.length < 20 && !heading) continue
    if (text.length < 20 && chapters.length === 0) continue
    const name = tocTitle.get(path) || heading || `第 ${chapters.length + 1} 部分`
    chapters.push({ title: name, body: text })
  }
  if (!chapters.length) throw new Error('这本 EPUB 里没有读到正文')
  return { title: title || '未命名', author, chapters }
}

/** 一本书 → 一篇 Markdown：`# 书名`、作者一行、每章 `## 章名` */
export function bookToMarkdown(book: EpubBook): string {
  const parts: string[] = [`# ${book.title}`]
  if (book.author) parts.push(`作者：${book.author}`)
  for (const c of book.chapters) {
    parts.push(`## ${c.title}`)
    if (c.body) parts.push(c.body)
  }
  return parts.join('\n\n') + '\n'
}
