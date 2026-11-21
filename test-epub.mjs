// EPUB 解析：用 python 现场打一个小 epub（deflate + stored 混合），走完整条链路
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEpub, bookToMarkdown, htmlToText, decodeEntities } from './src/core/epub.ts'

let ok = 0
function eq(name, got, want) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`✗ ${name}\n  期望: ${JSON.stringify(want)}\n  实际: ${JSON.stringify(got)}`)
    process.exit(1)
  }
  ok++
}

const dir = mkdtempSync(join(tmpdir(), 'epub-'))
const out = join(dir, 'a.epub')
execFileSync('python3', ['-c', `
import zipfile,sys
z=zipfile.ZipFile(sys.argv[1],'w')
z.writestr(zipfile.ZipInfo('mimetype'),'application/epub+zip',compress_type=zipfile.ZIP_STORED)
z.writestr('META-INF/container.xml','<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',compress_type=zipfile.ZIP_DEFLATED)
z.writestr('OEBPS/content.opf','''<package><metadata><dc:title>月下潮声</dc:title><dc:creator>某作者</dc:creator></metadata>
<manifest><item id="c0" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="a" href="text/ch1.xhtml" media-type="application/xhtml+xml"/><item id="b" href="text/ch2.xhtml" media-type="application/xhtml+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>
<spine><itemref idref="c0"/><itemref idref="a"/><itemref idref="b"/></spine></package>''',compress_type=zipfile.ZIP_DEFLATED)
z.writestr('OEBPS/cover.xhtml','<html><body><img src="c.jpg"/></body></html>',compress_type=zipfile.ZIP_DEFLATED)
z.writestr('OEBPS/text/ch1.xhtml','<html><head><title>x</title><style>p{}</style></head><body><h1>第一章 潮起</h1><p>他走到海边，&ldquo;风很大&rdquo;。</p><p>第二段&amp;结尾。<br/>换行。</p></body></html>',compress_type=zipfile.ZIP_DEFLATED)
z.writestr('OEBPS/text/ch2.xhtml','<html><body><p>没有标题的一章，正文足够长足够长足够长。</p></body></html>',compress_type=zipfile.ZIP_STORED)
z.writestr('OEBPS/toc.ncx','<ncx><navMap><navPoint id="1"><navLabel><text>第一章 潮起</text></navLabel><content src="text/ch1.xhtml"/></navPoint><navPoint id="2"><navLabel><text>第二章 落潮</text></navLabel><content src="text/ch2.xhtml"/></navPoint></navMap></ncx>',compress_type=zipfile.ZIP_DEFLATED)
z.close()
`, out])

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
console.log(`全部通过：${ok} 项`)
