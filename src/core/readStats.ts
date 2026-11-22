/**
 * 阅读统计：真实的阅读时间，按天 / 按小时 / 按书记。
 *
 * 只存在本机 localStorage，不进文档仓库（和书签、阅读位置一个道理：
 * 这是这台机器上这个人的习惯，不是文档的一部分，也不该触发自动 commit）。
 *
 * 「真实」的意思是：窗口在前台、有操作才计时。离开、失焦、挂机 30 秒以上都不算 ——
 * 否则开着阅读视图去吃了顿饭，统计里就多出一个小时。
 *
 * 这个文件全是纯函数（时间由参数传入），所以能在 node 里直接测。
 */

export interface DayStat {
  /** 这一天的总阅读秒数 */
  secs: number
  /** 24 个小时各自的秒数 */
  hours: number[]
  /** 书 id → 这一天在这本书上的秒数 */
  docs: Record<string, number>
}

export interface BookStat {
  title: string
  /** 累计秒数（全部时间，不受日期范围影响） */
  secs: number
  /** 第一次 / 最近一次读的时间戳 */
  first: number
  last: number
  /** 读到最后一页的时间戳；没读完就没有 */
  done?: number
}

export interface ReadStats {
  v: 1
  days: Record<string, DayStat>
  books: Record<string, BookStat>
}

export const EMPTY_STATS: ReadStats = { v: 1, days: {}, books: {} }

/** 超过这么久没操作就不计时（毫秒） */
export const IDLE_MS = 30_000
/** 只保留最近这么多天的逐日数据；书的累计不受影响 */
const KEEP_DAYS = 400

const pad = (n: number) => String(n).padStart(2, '0')

/** 本地时区的 YYYY-MM-DD */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const DAY_MS = 86_400_000

/** 往前推 n 天（用本地午间避开夏令时的 23/25 小时） */
function daysAgo(now: number, n: number): number {
  const d = new Date(now)
  d.setHours(12, 0, 0, 0)
  return d.getTime() - n * DAY_MS
}

const round1 = (n: number) => Math.round(n * 10) / 10

function emptyDay(): DayStat {
  return { secs: 0, hours: new Array<number>(24).fill(0), docs: {} }
}

/** 记一段阅读。at 是这段的起点，secs 是长度（一般只有几秒）。返回新对象，不改入参。 */
export function addReading(
  stats: ReadStats,
  p: { docId: string; title: string; at: number; secs: number },
): ReadStats {
  if (!p.docId || !(p.secs > 0)) return stats
  const key = dayKey(p.at)
  const hour = new Date(p.at).getHours()
  const day = stats.days[key] ?? emptyDay()
  const hours = day.hours.slice()
  hours[hour] = round1(hours[hour] + p.secs)
  const nextDay: DayStat = {
    secs: round1(day.secs + p.secs),
    hours,
    docs: { ...day.docs, [p.docId]: round1((day.docs[p.docId] ?? 0) + p.secs) },
  }
  const prev = stats.books[p.docId]
  const book: BookStat = {
    title: p.title || prev?.title || '未命名',
    secs: round1((prev?.secs ?? 0) + p.secs),
    first: prev?.first ?? p.at,
    last: Math.max(prev?.last ?? 0, p.at),
    ...(prev?.done ? { done: prev.done } : {}),
  }
  return prune({ ...stats, days: { ...stats.days, [key]: nextDay }, books: { ...stats.books, [p.docId]: book } }, p.at)
}

/** 标记读完。重复调用保留第一次的时间。 */
export function markFinished(stats: ReadStats, docId: string, title: string, at: number): ReadStats {
  const prev = stats.books[docId]
  if (prev?.done) return stats
  const book: BookStat = prev
    ? { ...prev, done: at }
    : { title: title || '未命名', secs: 0, first: at, last: at, done: at }
  return { ...stats, books: { ...stats.books, [docId]: book } }
}

/** 丢掉太老的逐日数据，免得 localStorage 无限长 */
function prune(stats: ReadStats, now: number): ReadStats {
  const cutoff = dayKey(daysAgo(now, KEEP_DAYS))
  const keys = Object.keys(stats.days)
  if (!keys.some((k) => k < cutoff)) return stats
  const days: Record<string, DayStat> = {}
  for (const k of keys) if (k >= cutoff) days[k] = stats.days[k]
  return { ...stats, days }
}

/* ------------------------------ 查询 ------------------------------ */

export interface DayPoint {
  key: string
  /** 0 = 周日 … 6 = 周六 */
  weekday: number
  secs: number
  /** 这一天有没有记录（没记录和记录为 0 是两回事，但这里只有「有数据」可区分） */
  recorded: boolean
}

/** 最近 n 天（含今天），从老到新，缺的天补 0 */
export function lastDays(stats: ReadStats, n: number, now: number): DayPoint[] {
  const out: DayPoint[] = []
  for (let i = n - 1; i >= 0; i -= 1) {
    const ts = daysAgo(now, i)
    const key = dayKey(ts)
    const d = stats.days[key]
    out.push({ key, weekday: new Date(ts).getDay(), secs: d?.secs ?? 0, recorded: Boolean(d) })
  }
  return out
}

export interface Summary {
  secs: number
  activeDays: number
  /** 日均（按范围内的总天数算，不只算活跃天） */
  avgSecs: number
  bestDay: DayPoint | null
}

export function summarize(points: DayPoint[]): Summary {
  const secs = points.reduce((s, p) => s + p.secs, 0)
  const active = points.filter((p) => p.secs > 0)
  const best = active.reduce<DayPoint | null>((b, p) => (!b || p.secs > b.secs ? p : b), null)
  return { secs, activeDays: active.length, avgSecs: points.length ? secs / points.length : 0, bestDay: best }
}

/**
 * 连续阅读天数。
 * current：到今天为止连着读了几天。今天还没读不算断 —— 从昨天往回数，
 * 免得一早打开统计就看见「连续 0 天」。
 */
export function streaks(stats: ReadStats, now: number): { current: number; longest: number } {
  const has = (key: string) => (stats.days[key]?.secs ?? 0) > 0
  let current = 0
  let i = has(dayKey(now)) ? 0 : 1
  while (has(dayKey(daysAgo(now, i)))) {
    current += 1
    i += 1
  }
  const keys = Object.keys(stats.days)
    .filter((k) => has(k))
    .sort()
  let longest = 0
  let run = 0
  let prevTs = 0
  for (const k of keys) {
    const ts = new Date(`${k}T12:00:00`).getTime()
    run = prevTs && Math.round((ts - prevTs) / DAY_MS) === 1 ? run + 1 : 1
    prevTs = ts
    longest = Math.max(longest, run)
  }
  return { current, longest }
}

/** 范围内 24 个小时各自的总秒数 */
export function hourTotals(stats: ReadStats, n: number, now: number): number[] {
  const out = new Array<number>(24).fill(0)
  for (const p of lastDays(stats, n, now)) {
    const d = stats.days[p.key]
    if (d) d.hours.forEach((s, h) => (out[h] += s))
  }
  return out
}

/** 范围内按星期（0=周日）的总秒数 */
export function weekdayTotals(points: DayPoint[]): number[] {
  const out = new Array<number>(7).fill(0)
  for (const p of points) out[p.weekday] += p.secs
  return out
}

export interface BookRow extends BookStat {
  id: string
  /** 范围内在这本书上花的秒数 */
  rangeSecs: number
}

/** 范围内读过的书，按范围内时长从多到少 */
export function booksInRange(stats: ReadStats, n: number, now: number): BookRow[] {
  const per: Record<string, number> = {}
  for (const p of lastDays(stats, n, now)) {
    const d = stats.days[p.key]
    if (d) for (const [id, s] of Object.entries(d.docs)) per[id] = (per[id] ?? 0) + s
  }
  return Object.entries(per)
    .map(([id, rangeSecs]) => ({ id, rangeSecs, ...(stats.books[id] ?? { title: '（已删除）', secs: rangeSecs, first: 0, last: 0 }) }))
    .sort((a, b) => b.rangeSecs - a.rangeSecs)
}

/** 「1 小时 5 分」「12 分」「40 秒」 */
export function fmtDuration(secs: number): string {
  const s = Math.round(secs)
  if (s < 60) return `${s} 秒`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} 分`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} 小时 ${r} 分` : `${h} 小时`
}

/* ------------------------------ 存取 ------------------------------ */

const KEY = 'quill:readstats'

export function loadStats(): ReadStats {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY_STATS
    const o = JSON.parse(raw) as Partial<ReadStats>
    return o && o.v === 1 && o.days && o.books ? (o as ReadStats) : EMPTY_STATS
  } catch {
    return EMPTY_STATS
  }
}

export function saveStats(s: ReadStats): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* 写不进去只是少记一点 */
  }
}

export function clearStats(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
