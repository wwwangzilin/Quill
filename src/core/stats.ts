/**
 * 写作数据的小计算：今日进度、连续写作天数。
 * 纯函数，方便 node 直接跑断言（见 test-core.mjs）。
 */

/** 本地时区的 YYYY-MM-DD（和 record_writing 写的键一致） */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

export interface GoalProgress {
  today: number
  goal: number
  /** 0～1，用于进度条 */
  ratio: number
  /** 还差多少字（已达标为 0） */
  remain: number
  done: boolean
}

export function goalProgress(stats: Record<string, number>, goal: number, now = new Date()): GoalProgress {
  const today = stats[dayKey(now)] ?? 0
  const safeGoal = Math.max(0, Math.round(goal))
  const ratio = safeGoal > 0 ? Math.min(1, today / safeGoal) : 0
  return {
    today,
    goal: safeGoal,
    ratio,
    remain: Math.max(0, safeGoal - today),
    done: safeGoal > 0 && today >= safeGoal,
  }
}

/**
 * 连续写作天数。
 * 今天还没写的话从昨天开始数 —— 不然早上打开软件就看到「连续 0 天」，
 * 明明昨天刚写过，太打击人了。
 */
export function streakDays(stats: Record<string, number>, now = new Date()): number {
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if ((stats[dayKey(cursor)] ?? 0) <= 0) cursor.setDate(cursor.getDate() - 1)

  let days = 0
  // 上限一年，防御性地兜住脏数据
  for (let i = 0; i < 366; i += 1) {
    if ((stats[dayKey(cursor)] ?? 0) <= 0) break
    days += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return days
}

/** 最近 n 天里有几天写过（热力图之外的一个小指标） */
export function activeDays(stats: Record<string, number>, n: number, now = new Date()): number {
  let count = 0
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  for (let i = 0; i < n; i += 1) {
    if ((stats[dayKey(cursor)] ?? 0) > 0) count += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return count
}
