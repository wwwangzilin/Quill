/**
 * 纯文本（.txt）→ Markdown。
 *
 * 两个坑，一个都不能少：
 *
 * ① **编码**。记事本存的、老软件导出的、从各种地方扒下来的 .txt，中文圈里
 *    大量是 GBK，而 `File.text()` 一律按 UTF-8 解码 —— 直接读就是满屏乱码。
 *    所以这里自己吃 ArrayBuffer，先按 UTF-8 **严格**解，解不动再退 GBK。
 *    浏览器的 TextDecoder 原生就带 gbk / big5，不用引任何依赖。
 *
 * ② **结构**。txt 没有结构，但也不该瞎猜：这里只做三件确定的事 ——
 *    去 BOM、统一换行、把三个以上连续空行压成一个。段落要不要拆、哪行算小标题，
 *    猜错了比不猜更糟（会把好好的一篇文章切得七零八落），留给人到编辑器里调。
 *    唯一主动做的是「首行看着像标题就拿它当标题」，而且只在它真的像的时候。
 */

export interface ImportedDoc {
  title: string
  content: string
}

const PLAIN = /\.(txt|text)$/i
const MARKDOWN = /\.(md|markdown)$/i

/** 这个文件名是我们认识的文本吗 */
export function isImportable(name: string): boolean {
  return PLAIN.test(name) || MARKDOWN.test(name)
}

/** 去掉扩展名，留作标题兜底 */
export function baseName(name: string): string {
  return name.replace(/\.(txt|text|md|markdown)$/i, '')
}

/**
 * 认编码并解码。
 *
 * 顺序是刻意的：**先 UTF-8 且 fatal**。因为 GBK 解码几乎不会失败
 * （任何字节序列它都能给你凑出字来），要是先试 GBK，UTF-8 的文件也会被
 * 当成 GBK 解成乱码。反过来先严格试 UTF-8，解不动才说明它多半不是 UTF-8。
 */
export function decodeText(buf: ArrayBuffer): { text: string; encoding: string } {
  // UTF-16 有 BOM 就能一眼认出；UTF-8 的 BOM 交给 TextDecoder 自己吞
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength))
  if (head[0] === 0xff && head[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buf), encoding: 'utf-16le' }
  }
  if (head[0] === 0xfe && head[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(buf), encoding: 'utf-16be' }
  }

  for (const enc of ['utf-8', 'gbk', 'big5']) {
    try {
      return { text: new TextDecoder(enc, { fatal: true }).decode(buf), encoding: enc }
    } catch {
      /* 这个编码解不动，换下一个 */
    }
  }
  // 都解不动就别硬撑了，有损解出来至少内容还在
  return { text: new TextDecoder('utf-8').decode(buf), encoding: 'utf-8（有损）' }
}

/** 读一个 File 并认编码 */
export async function readTextFile(file: File): Promise<{ text: string; encoding: string }> {
  return decodeText(await file.arrayBuffer())
}

/** 这一行看着像不像文章的标题 */
function looksLikeTitle(line: string): boolean {
  const t = line.trim()
  if (!t || t.length > 40) return false
  // 已经是列表 / 引用 / 标题标记的行，别抢过来当标题
  if (/^[#>\-*+\d]/.test(t)) return false
  // 结尾带标点的更像句子，不像标题
  if (/[。！？；：，、,.!?;:]$/.test(t)) return false
  return true
}

/** 行尾是不是句末标点 —— 中文排版里，只有句末标点才说明这一段说完了 */
const ENDS_SENTENCE = /[。！？…!?；;]$|[」』”"']$/

/** 这行是不是结构性的（列表 / 引用 / 标题 / 分隔线），合并折行时要绕开 */
const STRUCTURAL = /^\s*(?:[-*+•·]|\d+[.)、]|#|>|---)/

/**
 * 把被硬折行的段落接回去。
 *
 * 判据是中文排版本身的规矩：一段话说到句末标点才算完。行尾是逗号、顿号，
 * 或者干脆没标点的，那这行还没说完 —— 紧接着的下一行是它的续行，
 * 该接上而不是另起一段。这不是「猜」，是中文文本里确定的东西，所以敢用。
 *
 * 两道保险，免得把「每行一段」的清单合成一大坨：
 *   · 前一行得够长（> 12 字符），短行多半是标题或条目，不接；
 *   · 两边都不能是列表 / 引用 / 标题那种结构性行。
 */
function joinSoftWraps(lines: string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    const cur = line.trim()
    const prev = out.length ? out[out.length - 1] : null
    const joinable =
      prev !== null &&
      prev.trim() !== '' &&
      cur !== '' &&
      prev.trim().length > 12 &&
      !ENDS_SENTENCE.test(prev.trim()) &&
      !STRUCTURAL.test(cur) &&
      !STRUCTURAL.test(prev)
    if (joinable) {
      // 英文单词之间要留空格，中文直接接上
      const needSpace = /[A-Za-z0-9,.;:'")\]]$/.test(prev) && /^[A-Za-z0-9([]/.test(cur)
      out[out.length - 1] = prev.trimEnd() + (needSpace ? ' ' : '') + cur
    } else {
      out.push(line)
    }
  }
  return out
}

/**
 * 纯文本 → 一篇能直接落盘的 Markdown。
 *
 * 输出的正文一定带 `# 标题`：Quill 读盘时靠首个 H1 认标题
 * （见 core/md-parse.ts 的 splitTitle），少了它，文档在编辑器里就没有标题。
 */
export function txtToMarkdown(raw: string, fallbackTitle: string): ImportedDoc {
  const text = raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!text) return { title: fallbackTitle, content: `# ${fallbackTitle}\n` }

  // 本来就是 Markdown（开头就有 H1）—— 原样收下，别二次加工
  if (/^#\s+\S/.test(text)) {
    const m = text.match(/^#\s+(.+?)\s*(?:\n|$)/)
    return { title: m ? m[1].trim() : fallbackTitle, content: text + '\n' }
  }

  const lines = text.split('\n')
  let title = fallbackTitle
  let body = lines
  if (looksLikeTitle(lines[0])) {
    title = lines[0].trim()
    body = lines.slice(1)
  }
  const merged = joinSoftWraps(body)
    .join('\n')
    .replace(/^\n+/, '')
    .trim()
  return { title, content: `# ${title}\n\n${merged}\n` }
}

/** 读一个 File 并转成待落盘的文档（.txt 走转换，.md 原样） */
export async function readImportFile(file: File): Promise<ImportedDoc> {
  const { text } = await readTextFile(file)
  const name = baseName(file.name)
  return PLAIN.test(file.name) ? txtToMarkdown(text, name) : { title: name, content: text }
}

/**
 * 从一个路径（Tauri 原生拖拽给的是完整路径）读出来并转成待落盘的文档。
 *
 * 路径可能长这样：`C:\Users\JJ\Desktop\我的笔记.txt` —— 取文件名那一步要按
 * 两种分隔符都切，Windows 上反斜杠是主分隔符。
 */
export function docFromBytes(buf: ArrayBuffer, path: string): ImportedDoc {
  const { text } = decodeText(buf)
  const file = path.split(/[\\/]/).pop() ?? path
  const name = baseName(file)
  return PLAIN.test(file) ? txtToMarkdown(text, name) : { title: name, content: text }
}
