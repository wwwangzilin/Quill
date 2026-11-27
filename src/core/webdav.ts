/**
 * WebDAV 同步的纯逻辑：解析 PROPFIND、决定每篇文档该推还是该拉、起冲突副本的名字。
 * 不碰网络、不碰存储，node 下可直接测；真正发请求/读写文档的是 app/webdavSync.ts。
 *
 * 范围（有意收窄）：仓库根目录下的 .md 文档。
 *   不同步：删除（任一边删了，下次会从另一边补回来，宁可多一份也不丢）、
 *           assets/ 里的图片、标签 / 星标 / 批注这些元数据。
 */

export interface RemoteEntry {
  name: string
  isDir: boolean
  size: number
  /** 变化指纹：优先 ETag，没有就用 大小+修改时间 */
  tag: string
}

const unxml = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

const pick = (block: string, tag: string): string | null => {
  const m = new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'i').exec(block)
  return m ? unxml(m[1]).trim() : null
}

/**
 * 解析 207 Multi-Status。`baseUrl` 用来把集合自己（Depth 1 会连自己一起列出来）剔掉。
 * 只认目录下一层；名字取 href 最后一段并解码。
 */
export function parsePropfind(xml: string, baseUrl: string): RemoteEntry[] {
  const out: RemoteEntry[] = []
  const basePath = (() => {
    try {
      return decodeURIComponent(new URL(baseUrl).pathname).replace(/\/+$/, '')
    } catch {
      return ''
    }
  })()
  for (const m of xml.matchAll(/<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi)) {
    const block = m[1]
    const hrefRaw = pick(block, 'href')
    if (!hrefRaw) continue
    let path = hrefRaw
    try {
      path = /^https?:/i.test(hrefRaw) ? new URL(hrefRaw).pathname : hrefRaw
      path = decodeURIComponent(path)
    } catch {
      /* 解码失败就按原样用 */
    }
    const isDir = /<(?:[\w-]+:)?collection\b/i.test(block) || path.endsWith('/')
    const clean = path.replace(/\/+$/, '')
    if (clean === basePath || clean === '') continue
    const name = clean.split('/').pop() ?? ''
    if (!name) continue
    const size = Number(pick(block, 'getcontentlength') ?? 0) || 0
    const etag = pick(block, 'getetag')
    const mod = pick(block, 'getlastmodified') ?? ''
    out.push({ name, isDir, size, tag: etag ? etag.replace(/^W\//, '') : `${size}|${mod}` })
  }
  return out
}

export interface LocalDoc {
  /** 本地变化指纹：修改时间 + 字数，不用读正文 */
  sig: string
}
export interface BaseRec {
  /** 上次同步完成时本地的指纹 */
  l: string
  /** 上次同步完成时远端的指纹 */
  r: string
}
export type SyncOp = 'push' | 'pull' | 'compare' | 'skip'
export interface PlanItem {
  name: string
  op: SyncOp
  why: string
}

/**
 * 三方对比：本地现状 / 远端现状 / 上次同步完成时两边的样子。
 *
 * compare = 两边都动过（或第一次见面且两边都有）：得拉下远端正文逐字比一下，
 * 一样就只是补记账，不一样才算冲突。
 */
export function planSync(
  local: Map<string, LocalDoc>,
  remote: Map<string, { tag: string }>,
  base: Record<string, BaseRec>,
): PlanItem[] {
  const names = [...new Set([...local.keys(), ...remote.keys()])].sort()
  const plan: PlanItem[] = []
  for (const name of names) {
    const L = local.get(name)
    const R = remote.get(name)
    const B = base[name]
    if (L && !R) {
      plan.push({ name, op: 'push', why: B ? '远端没有了，补传' : '新文档' })
    } else if (!L && R) {
      plan.push({ name, op: 'pull', why: B ? '本地没有了，补回' : '远端新文档' })
    } else if (L && R) {
      if (!B) {
        plan.push({ name, op: 'compare', why: '第一次见到两边都有' })
        continue
      }
      const lc = L.sig !== B.l
      const rc = R.tag !== B.r
      if (lc && rc) plan.push({ name, op: 'compare', why: '两边都改过' })
      else if (lc) plan.push({ name, op: 'push', why: '本地有改动' })
      else if (rc) plan.push({ name, op: 'pull', why: '远端有改动' })
      else plan.push({ name, op: 'skip', why: '没变' })
    }
  }
  return plan
}

const p2 = (n: number) => String(n).padStart(2, '0')

/** 冲突时本机那份另存成：`原名 (冲突 20261122-1430).md` */
export function conflictName(name: string, d: Date): string {
  const stem = name.replace(/\.md$/i, '')
  return `${stem} (冲突 ${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}).md`
}

/** 换行统一后再比：Windows / Linux 之间转一趟不该算改动 */
export const sameText = (a: string, b: string) => a.replace(/\r\n?/g, '\n').trimEnd() === b.replace(/\r\n?/g, '\n').trimEnd()

/** 只同步根目录下的 .md；隐藏文件、回收站、assets 目录一律不碰 */
export const isSyncName = (name: string) => /\.md$/i.test(name) && !name.startsWith('.') && !/[\\/]/.test(name)

/** 目录 URL 规整：保证以 / 结尾 */
export function dirUrl(url: string): string {
  const u = url.trim()
  return u.endsWith('/') ? u : u + '/'
}

export const fileUrl = (dir: string, name: string) => dirUrl(dir) + encodeURIComponent(name)

/* ------------------------------ 元数据（标签 / 星标 / 批注） ------------------------------ */

export interface SyncComment {
  id: string
  quote: string
  note: string
  created: number
  resolved?: boolean
  color?: string
}
export interface SyncMeta {
  version: 1
  starred: string[]
  tags: Record<string, string[]>
  comments: Record<string, SyncComment[]>
}

export const META_REMOTE = '.quill-sync-meta.json'
export const emptyMeta = (): SyncMeta => ({ version: 1, starred: [], tags: {}, comments: {} })

/** 远端那份可能是别的版本写的、或被改坏了：能用多少用多少，绝不抛 */
export function parseMeta(text: string): SyncMeta {
  const out = emptyMeta()
  try {
    const o = JSON.parse(text) as Partial<SyncMeta>
    if (Array.isArray(o.starred)) out.starred = o.starred.filter((x): x is string => typeof x === 'string')
    if (o.tags && typeof o.tags === 'object') {
      for (const [k, v] of Object.entries(o.tags)) if (Array.isArray(v)) out.tags[k] = v.filter((x): x is string => typeof x === 'string')
    }
    if (o.comments && typeof o.comments === 'object') {
      for (const [k, v] of Object.entries(o.comments)) {
        if (!Array.isArray(v)) continue
        out.comments[k] = v.filter(
          (c): c is SyncComment => !!c && typeof c.id === 'string' && typeof c.quote === 'string' && typeof c.note === 'string',
        )
      }
    }
  } catch {
    /* 坏 JSON 当空的 */
  }
  return out
}

const uniq = <T>(a: T[]) => [...new Set(a)]

/**
 * 两边取并集：星标「任一边星标就算」，标签按文档取并集，批注按 id 取并集
 * （同 id 以本地字段为准，resolved 取「任一边已解决」）。
 * 所以**删**标签 / 批注不会同步 —— 删掉的那条下次会从另一边回来。
 * `names`：本地实际存在的文档；远端元数据里提到、但本地没有的文档不处理，也不写回。
 */
export function mergeMeta(local: SyncMeta, remote: SyncMeta, names: Set<string>): SyncMeta {
  const out = emptyMeta()
  out.starred = uniq([...local.starred, ...remote.starred]).filter((n) => names.has(n)).sort()
  for (const n of names) {
    const tags = uniq([...(local.tags[n] ?? []), ...(remote.tags[n] ?? [])])
    if (tags.length) out.tags[n] = tags
    const byId = new Map<string, SyncComment>()
    for (const c of local.comments[n] ?? []) byId.set(c.id, c)
    for (const c of remote.comments[n] ?? []) {
      const mine = byId.get(c.id)
      if (!mine) byId.set(c.id, c)
      else if (c.resolved && !mine.resolved) byId.set(c.id, { ...mine, resolved: true })
    }
    if (byId.size) out.comments[n] = [...byId.values()].sort((a, b) => a.created - b.created)
  }
  return out
}

/** 合并结果和本地现状比，列出本地要补的 */
export function metaDiff(local: SyncMeta, merged: SyncMeta) {
  const star = merged.starred.filter((n) => !local.starred.includes(n))
  const tags: Record<string, string[]> = {}
  for (const [n, t] of Object.entries(merged.tags)) {
    const cur = local.tags[n] ?? []
    if (t.length !== cur.length || t.some((x) => !cur.includes(x))) tags[n] = t
  }
  const comments: Record<string, SyncComment[]> = {}
  for (const [n, c] of Object.entries(merged.comments)) {
    const cur = local.comments[n] ?? []
    const same = c.length === cur.length && c.every((x, i) => cur[i] && cur[i].id === x.id && !!cur[i].resolved === !!x.resolved)
    if (!same) comments[n] = c
  }
  return { star, tags, comments }
}

export const metaEqual = (a: SyncMeta, b: SyncMeta) => JSON.stringify(a) === JSON.stringify(b)

/* ------------------------------ assets/ 图片 ------------------------------ */

export const ASSET_MAX = 25 * 1024 * 1024

export interface AssetPlan {
  push: string[]
  pull: string[]
  skipped: { name: string; why: string }[]
}

/**
 * 按文件名对：只有一边有的就补到另一边。同名视为同一个文件、不比内容
 * （仓库里的资源名带时间戳，几乎不会重名；真重名也只是少传一次，不会覆盖）。
 */
export function planAssets(local: { name: string; size: number }[], remote: { name: string; size: number }[], max = ASSET_MAX): AssetPlan {
  const lset = new Set(local.map((a) => a.name))
  const rset = new Set(remote.map((a) => a.name))
  const plan: AssetPlan = { push: [], pull: [], skipped: [] }
  for (const a of local) {
    if (rset.has(a.name)) continue
    if (a.size > max) plan.skipped.push({ name: a.name, why: `太大（${Math.round(a.size / 1024 / 1024)}MB）` })
    else plan.push.push(a.name)
  }
  for (const a of remote) {
    if (lset.has(a.name)) continue
    if (a.size > max) plan.skipped.push({ name: a.name, why: `太大（${Math.round(a.size / 1024 / 1024)}MB）` })
    else plan.pull.push(a.name)
  }
  return plan
}

/** assets 里的文件名：不能含路径、不能是隐藏文件 */
export const isAssetName = (n: string) => !!n && !n.startsWith('.') && !/[\\/]/.test(n) && !n.includes('..')
