// EPUB 解析：在 Node 里现场打一个小 epub（deflate + stored 混合），走完整条链路
//
// 以前这段是用 python3 现场打 zip —— Windows 上 `python3` 常常是应用商店的壳子，
// 在 CI 里直接失败。现在自己按 ZIP 规范写几十行，不引依赖、哪儿都能跑。
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { parseEpub, bookToMarkdown, htmlToText, decodeEntities } from './src/core/epub.ts'

let ok = 0
function eq(name, got, want) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`✗ ${name}\n  期望: ${JSON.stringify(want)}\n  实际: ${JSON.stringify(got)}`)
    process.exit(1)
  }
  ok++
}

/** CRC32（ZIP 每个条目都要） */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * 打一个最小可用的 zip。`store: true` 的条目原样存，其余 deflate。
 * 只为测试用：不写时间戳、不加密、不跨卷。
 */
function makeZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const raw = e.bytes ? Buffer.from(e.bytes) : Buffer.from(e.text, 'utf8')
    const method = e.store ? 0 : 8
    const body = e.store ? raw : deflateRawSync(raw)
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // 文件名是 UTF-8
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, body)

    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4)
    cen.writeUInt16LE(20, 6)
    cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt16LE(method, 10)
    cen.writeUInt16LE(0, 12)
    cen.writeUInt16LE(0, 14)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(body.length, 20)
    cen.writeUInt32LE(raw.length, 24)
    cen.writeUInt16LE(name.length, 28)
    cen.writeUInt32LE(offset, 42)
    centrals.push(cen, name)

    offset += local.length + name.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

const dir = mkdtempSync(join(tmpdir(), 'epub-'))
const out = join(dir, 'a.epub')
writeFileSync(
  out,
  makeZip([
    { name: 'mimetype', text: 'application/epub+zip', store: true },
    {
      name: 'META-INF/container.xml',
      text: '<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    },
    {
      name: 'OEBPS/content.opf',
      text: '<package><metadata><dc:title>月下潮声</dc:title><dc:creator>某作者</dc:creator></metadata>'
        + '<manifest><item id="c0" href="cover.xhtml" media-type="application/xhtml+xml"/>'
        + '<item id="a" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>'
        + '<item id="b" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>'
        + '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>'
        + '<spine><itemref idref="c0"/><itemref idref="a"/><itemref idref="b"/></spine></package>',
    },
    { name: 'OEBPS/cover.xhtml', text: '<html><body><img src="c.jpg"/></body></html>' },
    {
      name: 'OEBPS/text/ch1.xhtml',
      text: '<html><head><title>x</title><style>p{}</style></head><body><h1>第一章 潮起</h1>'
        + '<p>他走到海边，&ldquo;风很大&rdquo;。</p><p>第二段&amp;结尾。<br/>换行。</p></body></html>',
    },
    {
      name: 'OEBPS/text/ch2.xhtml',
      text: '<html><body><p>没有标题的一章，正文足够长足够长足够长。</p></body></html>',
      store: true,
    },
    {
      name: 'OEBPS/toc.ncx',
      text: '<ncx><navMap><navPoint id="1"><navLabel><text>第一章 潮起</text></navLabel><content src="text/ch1.xhtml"/></navPoint>'
        + '<navPoint id="2"><navLabel><text>第二章 落潮</text></navLabel><content src="text/ch2.xhtml"/></navPoint></navMap></ncx>',
    },
  ]),
)

const buf = readFileSync(out)
const book = await parseEpub(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
eq('书名作者', [book.title, book.author], ['月下潮声', '某作者'])
eq('封面页被跳过，剩两章', book.chapters.map((c) => c.title), ['第一章 潮起', '第二章 落潮'])
eq('实体与换行', book.chapters[0].body, '他走到海边，“风很大”。\n\n第二段&结尾。\n换行。')
eq('未压缩条目也能读', book.chapters[1].body.startsWith('没有标题的一章'), true)
const md = bookToMarkdown(book)
eq('Markdown 骨架', md.split('\n\n').slice(0, 3), ['# 月下潮声', '作者：某作者', '## 第一章 潮起'])
eq('实体', decodeEntities('&#x4e2d;&#25991;&amp;&unknown;'), '中文&&unknown;')
eq('ruby 注音只留本字', htmlToText('<body><p><ruby>漢<rt>kan</rt></ruby>字</p></body>').text, '漢字')
let bad = false
try { await parseEpub(new TextEncoder().encode('not a zip at all, definitely not').buffer) } catch { bad = true }
eq('坏文件抛错而不是死循环', bad, true)

// ---- 插图 ----
const out2 = join(dir, 'b.epub')
writeFileSync(
  out2,
  makeZip([
    { name: 'mimetype', text: 'application/epub+zip', store: true },
    {
      name: 'META-INF/container.xml',
      text: '<container><rootfiles><rootfile full-path="OPS/c.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    },
    {
      name: 'OPS/c.opf',
      text: '<package><metadata><dc:title>图书</dc:title></metadata>'
        + '<manifest><item id="cv" href="cover.xhtml" media-type="application/xhtml+xml"/>'
        + '<item id="a" href="t/a.xhtml" media-type="application/xhtml+xml"/>'
        + '<item id="il" href="t/il.xhtml" media-type="application/xhtml+xml"/>'
        + '<item id="b" href="t/b.xhtml" media-type="application/xhtml+xml"/>'
        + '<item id="i1" href="img/cover.png" media-type="image/png"/>'
        + '<item id="i2" href="img/in%20line.jpg" media-type="image/jpeg"/></manifest>'
        + '<spine><itemref idref="cv"/><itemref idref="a"/><itemref idref="il"/><itemref idref="b"/></spine></package>',
    },
    {
      name: 'OPS/cover.xhtml',
      text: '<html><body><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
        + '<image xlink:href="img/cover.png" width="1" height="1"/></svg></body></html>',
    },
    {
      name: 'OPS/t/a.xhtml',
      text: '<html><body><h1>第一章</h1><p>这一章的正文需要足够长才不会被当成空页。'
        + '<img src="../img/in%20line.jpg" alt="x"/>后面还有字。</p></body></html>',
    },
    { name: 'OPS/t/il.xhtml', text: '<html><body><div><img src="../img/cover.png"/></div></body></html>' },
    {
      name: 'OPS/t/b.xhtml',
      text: '<html><body><h1>第二章</h1><p>第二章的正文同样要足够长足够长足够长。</p></body></html>',
    },
    { name: 'OPS/img/cover.png', bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x2d, 0x66, 0x61, 0x6b, 0x65]), store: true },
    { name: 'OPS/img/in line.jpg', bytes: new TextEncoder().encode('JPEGDATA') },
  ]),
)
const b2f = readFileSync(out2)
const bk = await parseEpub(b2f.buffer.slice(b2f.byteOffset, b2f.byteOffset + b2f.byteLength), { images: true })
eq('封面进 front', bk.images.front, ['OPS/img/cover.png'])
eq('章间插图并进上一章', bk.chapters[0].body.endsWith('⟦img:OPS/img/cover.png⟧'), true)
eq('行内图（含 %20 路径）单独成段', bk.chapters[0].body.includes('\n\n⟦img:OPS/img/in line.jpg⟧\n\n后面还有字'), true)
const r = await bk.images.read('OPS/img/in line.jpg')
eq('读图字节与类型', [new TextDecoder().decode(r.data), r.type], ['JPEGDATA', 'image/jpeg'])
eq('不存在的图', await bk.images.read('nope.png'), null)
const md2 = bookToMarkdown(bk, (p) => 'assets/' + p.split('/').pop().replace(' ', '_'))
eq('Markdown 里是 ![]()', md2.includes('![](assets/cover.png)') && md2.includes('![](assets/in_line.jpg)'), true)
eq('没解析出的图被丢掉不留标记', bookToMarkdown(bk).includes('⟦'), false)
const noimg = await parseEpub(b2f.buffer.slice(b2f.byteOffset, b2f.byteOffset + b2f.byteLength))
eq('默认不要图：没有标记也没有 images', [noimg.images, noimg.chapters[0].body.includes('⟦')], [undefined, false])
console.log(`全部通过：${ok} 项`)
