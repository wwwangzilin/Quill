/** 复制引用的格式：一段选中的原文 + 书名 + 章节 → 可以直接贴进笔记 / 聊天的文字。纯函数。 */
export type QuoteFmt = 'plain' | 'cite' | 'md'

export const QUOTE_FMTS: { id: QuoteFmt; name: string; sample: string }[] = [
  { id: 'plain', name: '只复制原文', sample: '原文' },
  { id: 'cite', name: '原文 + 出处', sample: '「原文」——《书名》· 章节' },
  { id: 'md', name: 'Markdown 引用', sample: '> 原文\\n> —— 《书名》· 章节' },
]

export const isQuoteFmt = (v: unknown): v is QuoteFmt => QUOTE_FMTS.some((f) => f.id === v)

export function formatQuote(text: string, meta: { title?: string; chapter?: string }, fmt: QuoteFmt): string {
  const body = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!body || fmt === 'plain') return body
  const book = meta.title ? `《${meta.title}》` : ''
  const ch = meta.chapter && meta.chapter !== meta.title ? meta.chapter : ''
  const src = book && ch ? `${book}· ${ch}` : book || ch
  if (fmt === 'cite') return src ? `「${body}」——${src}` : `「${body}」`
  const quoted = body.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')
  return src ? `${quoted}\n> —— ${src}` : quoted
}

const KEY = 'quill-set:quote-fmt'
export function loadQuoteFmt(): QuoteFmt {
  try {
    const v = localStorage.getItem(KEY)
    return isQuoteFmt(v) ? v : 'cite'
  } catch {
    return 'cite'
  }
}
export function saveQuoteFmt(f: QuoteFmt): void {
  try {
    localStorage.setItem(KEY, f)
  } catch {
    /* 记不住就下次再选 */
  }
}
