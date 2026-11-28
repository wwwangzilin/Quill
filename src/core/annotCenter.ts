/**
 * 批注与书签中心的纯逻辑：跨书检索 + 每本书导出一份 Markdown。
 * 不碰 DOM / 存储，数据由调用方读好传进来，node 下可测。
 */
import { safeName, type ZipFile } from './zip.ts'
import { dayKey } from './readStats.ts'
import type { CardState } from './review'

export interface AComment {
  id: string
  quote: string
  note: string
  created: number
  color?: string
  tags?: string[]
}
export interface ABookmark {
  id: string
  label: string
  chapter?: string
  cat?: string
}
export interface AEntry {
  docId: string
  docTitle: string
  comments: AComment[]
  bookmarks: ABookmark[]
}

export type AnnotHit =
  | { kind: 'comment'; id: string; quote: string; note: string; created: number }
  | { kind: 'bookmark'; id: string; label: string }

export interface AnnotGroup {
  docId: string
  docTitle: string
  hits: AnnotHit[]
}

const norm = (s: string) => s.toLowerCase()

/** 在批注的引文 / 批注文字、书签的章节标题里找关键词（不区分大小写）；书名命中时整本书的批注都算命中 */
export function searchAnnots(entries: AEntry[], query: string, limit = 200): { groups: AnnotGroup[]; total: number; truncated: boolean } {
  const q = norm(query.trim())
  const groups: AnnotGroup[] = []
  let total = 0
  let truncated = false
  if (!q) return { groups, total, truncated }
  for (const e of entries) {
    const bookHit = norm(e.docTitle).includes(q)
    const hits: AnnotHit[] = []
    for (const c of e.comments) {
      if (bookHit || norm(c.quote).includes(q) || norm(c.note).includes(q) || (c.tags ?? []).some((t) => norm(t).includes(q))) {
        hits.push({ kind: 'comment', id: c.id, quote: c.quote, note: c.note, created: c.created })
      }
    }
    for (const b of e.bookmarks) {
      if (bookHit || norm(b.label).includes(q) || norm(b.chapter ?? '').includes(q)) {
        hits.push({ kind: 'bookmark', id: b.id, label: b.label })
      }
    }
    if (!hits.length) continue
    const room = limit - total
    if (room <= 0) {
      truncated = true
      break
    }
    if (hits.length > room) {
      hits.length = room
      truncated = true
    }
    total += hits.length
    groups.push({ docId: e.docId, docTitle: e.docTitle, hits })
  }
  return { groups, total, truncated }
}

/** 把文字按关键词切成 [普通, 命中, 普通, …]，界面里给命中的加高亮；大小写不敏感 */
export function splitByQuery(text: string, query: string): { t: string; hit: boolean }[] {
  const q = query.trim()
  if (!q) return [{ t: text, hit: false }]
  const lo = text.toLowerCase()
  const nq = q.toLowerCase()
  if (lo.length !== text.length) return [{ t: text, hit: false }]
  const out: { t: string; hit: boolean }[] = []
  let at = 0
  for (let i = lo.indexOf(nq); i >= 0; i = lo.indexOf(nq, at)) {
    if (i > at) out.push({ t: text.slice(at, i), hit: false })
    out.push({ t: text.slice(i, i + nq.length), hit: true })
    at = i + nq.length
  }
  if (at < text.length) out.push({ t: text.slice(at), hit: false })
  return out
}

const COLOR_NAME: Record<string, string> = { yellow: '黄', green: '绿', blue: '蓝', pink: '粉', purple: '紫' }
const CAT_NAME: Record<string, string> = { key: '重点', todo: '待查', love: '喜欢', plot: '伏笔' }

function reviewLine(s: CardState | undefined): string {
  if (!s) return '未复习'
  return `下次复习 ${dayKey(s.due)}（间隔 ${s.ivl} 天）`
}

/** 一本书 → 一份 Markdown：批注（含复习状态）+ 书签 */
export function bookMarkdown(e: AEntry, states: Record<string, CardState> = {}, now = Date.now()): string {
  const L: string[] = [`# 《${e.docTitle || '未命名'}》· 批注与书签`, '']
  L.push(`> ${e.comments.length} 条批注 · ${e.bookmarks.length} 个书签 · 导出于 ${dayKey(now)}`, '')
  if (e.comments.length) {
    L.push('## 批注', '')
    const list = [...e.comments].sort((a, b) => a.created - b.created)
    for (const c of list) {
      L.push(`> ${c.quote.replace(/\s*\n\s*/g, ' ').trim()}`, '')
      if (c.note.trim()) L.push(c.note.trim(), '')
      const meta = [(c.tags ?? []).map((t) => `#${t}`).join(' '), c.color ? `${COLOR_NAME[c.color] ?? c.color}色` : '', dayKey(c.created), reviewLine(states[c.id])].filter(Boolean)
      L.push(`<sub>${meta.join(' · ')}</sub>`, '')
    }
  }
  if (e.bookmarks.length) {
    L.push('## 书签', '')
    for (const b of e.bookmarks) L.push(`- ${b.label}${b.cat ? `（${CAT_NAME[b.cat] ?? b.cat}）` : ''}`)
    L.push('')
  }
  return L.join('\n').trimEnd() + '\n'
}

/** 全部有内容的书各一份 .md；同名书加序号，避免 zip 里互相覆盖 */
export function exportFiles(
  entries: AEntry[],
  statesOf: (docId: string) => Record<string, CardState>,
  now = Date.now(),
): ZipFile[] {
  const enc = new TextEncoder()
  const used = new Map<string, number>()
  const files: ZipFile[] = []
  for (const e of entries) {
    if (!e.comments.length && !e.bookmarks.length) continue
    const base = safeName(e.docTitle || '未命名', 40)
    const n = (used.get(base) ?? 0) + 1
    used.set(base, n)
    files.push({ name: `${base}${n > 1 ? `-${n}` : ''}.md`, data: enc.encode(bookMarkdown(e, statesOf(e.docId), now)) })
  }
  return files
}
