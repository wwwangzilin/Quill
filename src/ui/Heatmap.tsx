import { useMemo } from 'react'

interface Props {
  stats: Record<string, number>
  weeks?: number
}

function levelOf(n: number): string {
  if (n <= 0) return ''
  if (n < 100) return 'l1'
  if (n < 300) return 'l2'
  if (n < 600) return 'l3'
  return 'l4'
}

/** 写作热力图：每列一周，颜色越亮当天写的字越多 */
export default function Heatmap({ stats, weeks = 12 }: Props) {
  const cols = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const days: { key: string; count: number }[] = []
    for (let i = weeks * 7 - 1; i >= 0; i -= 1) {
      const d = new Date(today.getTime() - i * 86400000)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate(),
      ).padStart(2, '0')}`
      days.push({ key, count: stats[key] ?? 0 })
    }
    const out: (typeof days)[] = []
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7))
    return out
  }, [stats, weeks])

  const total = useMemo(
    () => Object.values(stats).reduce((n, v) => n + v, 0),
    [stats],
  )

  return (
    <div>
      <div className="heatmap">
        {cols.map((col, i) => (
          <div className="heat-col" key={i}>
            {col.map((d) => (
              <div
                key={d.key}
                className={`heat-cell ${levelOf(d.count)}`}
                title={`${d.key} · ${d.count} 字`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 7 }}>
        <span>累计 {total.toLocaleString()} 字</span>
      </div>
    </div>
  )
}
