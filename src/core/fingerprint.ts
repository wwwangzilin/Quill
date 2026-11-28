/**
 * 文本指纹（bottom-k 最小哈希）：判断两本书是不是「差不多是同一本」。
 *
 * 取全文每个 N 字窗口的哈希，保留最小的 K 个。两本书哪怕章节数、前后记不同，
 * 只要内容大段重合，它们的最小 K 个哈希就会大量重合 —— Jaccard 估计 ≈ 内容重合度。
 * 只存 K 个整数，不存原文。
 */
const WINDOW = 10
export const FP_SIZE = 96

/** 去掉空白和标点再比：排版、换行、标点全角半角不同的两份文本也算一样 */
export function normalizeForFp(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase()
}

// FNV-1a 32 位，对窗口字符串滚动重算（窗口小，直接算就够快）
function h32(s: string, from: number, len: number): number {
  let h = 0x811c9dc5
  for (let i = from; i < from + len; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function fingerprint(text: string): number[] {
  const s = normalizeForFp(text)
  if (s.length < WINDOW * 4) return [] // 太短没有比较意义
  // 为避免对几百万字逐个窗口都排序：只保留当前最小的 K 个（用最大堆思路的简化版：数组 + 阈值）
  const keep: number[] = []
  const seen = new Set<number>()
  let maxKept = 0xffffffff
  for (let i = 0; i + WINDOW <= s.length; i += 1) {
    const h = h32(s, i, WINDOW)
    if (h >= maxKept && keep.length >= FP_SIZE) continue
    if (seen.has(h)) continue
    seen.add(h)
    keep.push(h)
    if (keep.length > FP_SIZE * 2) {
      keep.sort((a, b) => a - b)
      keep.length = FP_SIZE
      maxKept = keep[FP_SIZE - 1]
    }
  }
  keep.sort((a, b) => a - b)
  return keep.slice(0, FP_SIZE)
}

/** 两份指纹的相似度 0~1；任一为空返回 0 */
export function similarity(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0
  const k = Math.min(FP_SIZE, a.length, b.length)
  const A = new Set(a.slice(0, k))
  const B = new Set(b.slice(0, k))
  // bottom-k 估计：合并后取最小的 k 个，看有多少同时出现在两边
  const merged = [...new Set([...A, ...B])].sort((x, y) => x - y).slice(0, k)
  return merged.filter((x) => A.has(x) && B.has(x)).length / k
}

const KEY = (docId: string) => `quill:fp:${docId}`
export function loadFp(docId: string): number[] {
  try {
    const j = JSON.parse(localStorage.getItem(KEY(docId)) ?? '[]')
    return Array.isArray(j) ? j.filter((n): n is number => typeof n === 'number') : []
  } catch {
    return []
  }
}
export function saveFp(docId: string, fp: number[]): void {
  try {
    if (fp.length) localStorage.setItem(KEY(docId), JSON.stringify(fp))
  } catch {
    /* 记不住只是下次导入不提醒 */
  }
}

/** 在已有书里找最像的一本；低于阈值返回 null */
export function mostSimilar(fp: number[], others: { id: string; fp: number[] }[], threshold = 0.5): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null
  for (const o of others) {
    const s = similarity(fp, o.fp)
    if (s >= threshold && (!best || s > best.score)) best = { id: o.id, score: s }
  }
  return best
}

/* ---- 导入查重：导入的书没有 id（Rust 端落盘时才定），所以按「标题 + 指纹」记一份索引 ---- */
const IDX_KEY = 'quill:fp-index'
const IDX_MAX = 120
export interface FpEntry {
  title: string
  fp: number[]
}
export function loadFpIndex(): FpEntry[] {
  try {
    const j = JSON.parse(localStorage.getItem(IDX_KEY) ?? '[]')
    return Array.isArray(j)
      ? j.filter((e): e is FpEntry => !!e && typeof e.title === 'string' && Array.isArray(e.fp))
      : []
  } catch {
    return []
  }
}

/**
 * 给这批待导入的文档找「疑似重复」：先和索引里以前导入过的比，再互相比（同一批里重复也算）。
 * 太短的文本（< 200 字）指纹不可靠，不查也不记。返回提示列表，并把新指纹写进索引。
 */
export function checkImports(items: { title: string; content: string }[]): { title: string; like: string; score: number }[] {
  const idx = loadFpIndex()
  const out: { title: string; like: string; score: number }[] = []
  for (const it of items) {
    if (it.content.length < 200) continue
    const fp = fingerprint(it.content)
    if (!fp.length) continue
    const hit = mostSimilar(
      fp,
      idx.map((e, i) => ({ id: String(i), fp: e.fp })),
    )
    if (hit) out.push({ title: it.title, like: idx[Number(hit.id)].title, score: hit.score })
    idx.push({ title: it.title, fp })
  }
  try {
    localStorage.setItem(IDX_KEY, JSON.stringify(idx.slice(-IDX_MAX)))
  } catch {
    /* 存不下就算了 */
  }
  return out
}
