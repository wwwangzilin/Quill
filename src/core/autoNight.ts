/**
 * 夜间自动切换：到了设定的时段，阅读视图自动用「夜间」配色，过了再回到你自己选的那套。
 * 只改**显示**用的主题，不动你存下来的选择。纯函数，时间由参数传入。
 */
export interface NightCfg {
  on: boolean
  /** 开始 / 结束，24 小时制 "HH:MM"；结束比开始早 = 跨午夜（如 21:00 → 06:00） */
  from: string
  to: string
}

export const DEFAULT_NIGHT: NightCfg = { on: false, from: '21:00', to: '06:00' }

/** "HH:MM" → 当天第几分钟；格式不对返回 null */
export function parseHM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  return h <= 23 && mi <= 59 ? h * 60 + mi : null
}

/** 现在（当天第几分钟）是否落在 [from, to) 里，支持跨午夜；from == to 视为全天关闭 */
export function inWindow(nowMin: number, from: number, to: number): boolean {
  if (from === to) return false
  return from < to ? nowMin >= from && nowMin < to : nowMin >= from || nowMin < to
}

export function isNight(cfg: NightCfg, now: Date): boolean {
  if (!cfg.on) return false
  const f = parseHM(cfg.from)
  const t = parseHM(cfg.to)
  if (f === null || t === null) return false
  return inWindow(now.getHours() * 60 + now.getMinutes(), f, t)
}

/** 实际要显示的主题：夜间时段强制 dark，否则用自己选的 */
export function effectiveTheme<T extends string>(chosen: T, cfg: NightCfg, now: Date, dark: T): T {
  return isNight(cfg, now) ? dark : chosen
}

/** 规整一份读出来的配置，缺字段 / 类型不对的回默认 */
export function normalizeNight(v: unknown): NightCfg {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    on: o.on === true,
    from: typeof o.from === 'string' && parseHM(o.from) !== null ? o.from : DEFAULT_NIGHT.from,
    to: typeof o.to === 'string' && parseHM(o.to) !== null ? o.to : DEFAULT_NIGHT.to,
  }
}

const KEY = 'quill-set:reader-night'
export function loadNight(): NightCfg {
  try {
    return normalizeNight(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return DEFAULT_NIGHT
  }
}
export function saveNight(c: NightCfg): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    /* 记不住就下次再设 */
  }
}
