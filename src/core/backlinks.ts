/**
 * 反向链接：谁在正文里写了 `[[这篇文档]]`。
 *
 * [[ ]] 的跳转早就有了，但「谁引用了我」一直缺着 ——
 * 双向链接的另一半就是它。
 */
import { storage } from './storage'
import type { DocMeta } from './types'
import { linksInJson } from '../editor/wikilink'

export interface BacklinkHit {
  id: string
  title: string
  updatedAt: number
  /** 命中处的上下文片段 */
  snippets: string[]
}

/** 逐篇读内容是有代价的，所以有上限 + 缓存 */
const SCAN_LIMIT = 200
const cache = new Map<string, { key: string; hits: BacklinkHit[] }>()

/** 引用当前文档的写法：带不带 .md 后缀都认 */
function namesOf(title: string): string[] {
  const t = title.trim()
  if (!t) return []
  return t.endsWith('.md') ? [t, t.slice(0, -3)] : [t, `${t}.md`]
}

function snippetsOf(node: unknown, names: string[], limit = 2): string[] {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (out.length >= limit || !n || typeof n !== 'object') return
    const obj = n as { type?: string; text?: string; content?: unknown[] }
    if (obj.type === 'text' && typeof obj.text === 'string') {
      for (const name of names) {
        const idx = obj.text.indexOf(`[[${name}]]`)
        if (idx < 0) continue
        const start = Math.max(0, idx - 36)
        const end = Math.min(obj.text.length, idx + name.length + 44)
        out.push(
          (start > 0 ? '…' : '') +
            obj.text.slice(start, end).replace(/\s+/g, ' ').trim() +
            (end < obj.text.length ? '…' : ''),
        )
        return
      }
    }
    obj.content?.forEach(walk)
  }
  walk(node)
  return out
}

/**
 * 找出引用了 `current` 的所有文档。
 * 结果按「池子里每篇文档的更新时间」做指纹缓存，没改过就不重扫。
 */
export async function findBacklinks(
  current: { id: string; title: string },
  docs: DocMeta[],
): Promise<BacklinkHit[]> {
  const names = namesOf(current.title)
  if (!names.length) return []

  const pool = docs.filter((d) => d.id !== current.id).slice(0, SCAN_LIMIT)
  const fingerprint = `${names.join(',')}#${pool.map((d) => `${d.id}:${d.updatedAt}`).join('|')}`
  const cached = cache.get(current.id)
  if (cached && cached.key === fingerprint) return cached.hits

  const hits: BacklinkHit[] = []
  for (const meta of pool) {
    try {
      const doc = await storage.get(meta.id)
      if (!doc) continue
      const links = linksInJson(doc.content)
      if (!links.some((l) => names.includes(l.trim()))) continue
      hits.push({
        id: doc.id,
        title: doc.title,
        updatedAt: doc.updatedAt,
        snippets: snippetsOf(doc.content, names),
      })
    } catch {
      /* 单篇读失败不影响整体 */
    }
  }

  hits.sort((a, b) => b.updatedAt - a.updatedAt)
  cache.set(current.id, { key: fingerprint, hits })
  return hits
}

/** 文档改名后旧缓存就没意义了，清一下 */
export function clearBacklinkCache(): void {
  cache.clear()
}
