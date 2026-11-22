// 阅读统计：计时累加、跨天/小时、连续天数、范围汇总、读完标记
import { EMPTY_STATS, addReading, markFinished, lastDays, summarize, streaks, hourTotals, weekdayTotals, booksInRange, fmtDuration, dayKey } from './src/core/readStats.ts'

let ok = 0
function eq(name, got, want) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`✗ ${name}\n  期望: ${JSON.stringify(want)}\n  实际: ${JSON.stringify(got)}`)
    process.exit(1)
  }
  ok++
}
const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const NOW = at(2026, 11, 21, 20, 30)

let s = EMPTY_STATS
s = addReading(s, { docId: 'a', title: '月下潮声', at: at(2026, 11, 21, 20, 10), secs: 300 })
s = addReading(s, { docId: 'a', title: '月下潮声', at: at(2026, 11, 21, 21, 0), secs: 60 })
s = addReading(s, { docId: 'b', title: '山海', at: at(2026, 11, 20, 9, 0), secs: 120 })
eq('不改入参', EMPTY_STATS.days, {})
eq('当天累计', s.days['2026-11-21'].secs, 360)
eq('按小时拆开', [s.days['2026-11-21'].hours[20], s.days['2026-11-21'].hours[21]], [300, 60])
eq('按书拆开', s.days['2026-11-21'].docs, { a: 360 })
eq('书的累计与首末次', [s.books.a.secs, s.books.a.first, s.books.a.last], [360, at(2026, 11, 21, 20, 10), at(2026, 11, 21, 21, 0)])
eq('空秒数不记', addReading(s, { docId: 'a', title: 'x', at: NOW, secs: 0 }), s)

const pts = lastDays(s, 7, NOW)
eq('最近 7 天，从老到新，缺的补 0', [pts.length, pts[0].key, pts[6].key, pts[5].secs, pts[6].secs, pts[0].recorded], [7, '2026-11-15', '2026-11-21', 120, 360, false])
const sum = summarize(pts)
eq('汇总', [sum.secs, sum.activeDays, Math.round(sum.avgSecs), sum.bestDay.key], [480, 2, 69, '2026-11-21'])
eq('连续天数（今天读了）', streaks(s, NOW), { current: 2, longest: 2 })
// 今天没读：从昨天往回数，不算断
const yest = addReading(EMPTY_STATS, { docId: 'a', title: 'a', at: at(2026, 11, 20), secs: 10 })
eq('今天没读，连续从昨天算', streaks(yest, NOW).current, 1)
let gap = addReading(EMPTY_STATS, { docId: 'a', title: 'a', at: at(2026, 11, 1), secs: 10 })
for (const d of [2, 3, 4]) gap = addReading(gap, { docId: 'a', title: 'a', at: at(2026, 11, d), secs: 10 })
gap = addReading(gap, { docId: 'a', title: 'a', at: at(2026, 11, 10), secs: 10 })
eq('最长连续 = 4，当前 = 0', streaks(gap, NOW), { current: 0, longest: 4 })
eq('24 小时分布', hourTotals(s, 7, NOW).map((x, h) => (x ? [h, x] : null)).filter(Boolean), [[9, 120], [20, 300], [21, 60]])
eq('按星期（2026-11-21 是周六，11-20 是周五）', weekdayTotals(pts).map((x, i) => (x ? [i, x] : null)).filter(Boolean), [[5, 120], [6, 360]])
eq('范围内的书按时长排', booksInRange(s, 7, NOW).map((b) => [b.id, b.rangeSecs]), [['a', 360], ['b', 120]])
eq('范围缩到 1 天只剩今天的书', booksInRange(s, 1, NOW).map((b) => b.id), ['a'])
const fin = markFinished(s, 'a', '月下潮声', NOW)
eq('读完标记', fin.books.a.done, NOW)
eq('重复标记保留第一次', markFinished(fin, 'a', '月下潮声', NOW + 5000).books.a.done, NOW)
eq('没读过的书直接读完也能记', markFinished(EMPTY_STATS, 'z', '新书', NOW).books.z.done, NOW)
// 老数据被修剪
const old = addReading(s, { docId: 'a', title: 'a', at: NOW + 500 * 86400000, secs: 5 })
eq('超过 400 天的逐日数据被丢掉，书累计还在', [Object.keys(old.days).includes('2026-11-21'), old.books.a.secs > 360], [false, true])
eq('时长文案', [fmtDuration(40), fmtDuration(725), fmtDuration(3600), fmtDuration(3900)], ['40 秒', '12 分', '1 小时', '1 小时 5 分'])
eq('dayKey 本地时区', dayKey(at(2026, 1, 5, 23, 59)), '2026-01-05')
console.log(`全部通过：${ok} 项`)
