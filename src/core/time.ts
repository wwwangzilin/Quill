const DAY = 86400000

function hm(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function sameDay(a: number, b: number): boolean {
  const x = new Date(a)
  const y = new Date(b)
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  )
}

/** 相对时间：刚刚 / 12 分钟前 / 今天 14:30 / 昨天 09:12 / 3月5日 / 2025年12月1日 */
export function formatWhen(ts: number): string {
  const now = Date.now()
  const diff = now - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (sameDay(ts, now)) return `今天 ${hm(ts)}`
  if (sameDay(ts, now - DAY)) return `昨天 ${hm(ts)}`
  const d = new Date(ts)
  if (diff < 7 * DAY) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm(ts)}`
  if (d.getFullYear() === new Date(now).getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

/** 列表分组：今天 / 昨天 / 七天内 / 更早 */
export function groupOf(ts: number): string {
  const now = Date.now()
  if (sameDay(ts, now)) return '今天'
  if (sameDay(ts, now - DAY)) return '昨天'
  if (now - ts < 7 * DAY) return '七天内'
  return '更早'
}
