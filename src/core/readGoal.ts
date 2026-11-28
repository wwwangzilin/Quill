/**
 * 每日阅读目标：今天读够没有、离目标还差多久、连续几天达标。
 * 数据来自阅读统计（本机），目标分钟数存 localStorage；纯函数部分可在 node 下测。
 */
import { dayKey } from './readStats.ts'

export interface GoalProgress {
  /** 0~1，满了就是 1 */
  frac: number
  done: boolean
  /** 还差多少分钟（向上取整，≥0） */
  leftMin: number
}

export function goalProgress(secsToday: number, goalMin: number): GoalProgress {
  if (!(goalMin > 0)) return { frac: 0, done: false, leftMin: 0 }
  const frac = Math.max(0, Math.min(1, secsToday / (goalMin * 60)))
  return { frac, done: frac >= 1, leftMin: Math.max(0, Math.ceil(goalMin - secsToday / 60)) }
}

const DAY = 86_400_000

/**
 * 连续达标天数。今天还没达标不算断（从昨天往回数），免得一早就看见「0 天」；
 * 今天已经达标就把今天算进去。
 */
export function goalStreak(days: Record<string, { secs: number }>, goalMin: number, now: number): number {
  if (!(goalMin > 0)) return 0
  const need = goalMin * 60
  const hit = (ts: number) => (days[dayKey(ts)]?.secs ?? 0) >= need
  // 用本地午间往回推，避开夏令时 23/25 小时
  const noon = (ts: number) => {
    const d = new Date(ts)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime()
  }
  let t = noon(now)
  let n = 0
  if (hit(t)) n = 1
  for (t -= DAY; hit(t); t -= DAY) n += 1
  return n
}

const KEY = 'quill-set:read-goal'
export const GOAL_PRESETS = [15, 30, 60, 90] as const

export function loadGoal(): number {
  try {
    const v = Number(localStorage.getItem(KEY))
    return v > 0 && v <= 1440 ? Math.round(v) : 0
  } catch {
    return 0
  }
}
export function saveGoal(min: number): void {
  try {
    if (min > 0) localStorage.setItem(KEY, String(Math.min(1440, Math.round(min))))
    else localStorage.removeItem(KEY)
  } catch {
    /* 记不住就下次再设 */
  }
}
