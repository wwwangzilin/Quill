import { useEffect, useMemo, useState } from 'react'
import {
  booksInRange,
  booksOnDay,
  clearStats,
  dayKey,
  fmtDuration,
  hourTotals,
  lastDays,
  loadStats,
  streaks,
  summarize,
  weekdayTotals,
  type DayPoint,
} from '../core/readStats'
import { goalProgress, goalStreak, loadGoal, saveGoal } from '../core/readGoal'
import { GoalPicker } from './GoalRing'

interface Props {
  open: boolean
  onClose: () => void
}

const RANGES = [7, 30, 90, 365] as const
type Tab = 'overview' | 'rhythm' | 'books'
const TABS: { id: Tab; name: string }[] = [
  { id: 'overview', name: '总览' },
  { id: 'rhythm', name: '节律' },
  { id: 'books', name: '书目' },
]
const WEEK = ['日', '一', '二', '三', '四', '五', '六']

interface Tip {
  x: number
  y: number
  text: string
}

const dateText = (ts: number) => (ts ? new Date(ts).toLocaleDateString('zh-CN') : '—')

/**
 * 阅读统计。数据来自 core/readStats（本机 localStorage），这里只负责画。
 *
 * 图表只用一个主题色的深浅表示多少（单序列），不靠色相区分；
 * 每个柱子、格子都能悬停看到具体数值，数值不写在图上，免得挤成一团。
 */
export default function StatsPanel({ open, onClose }: Props) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(30)
  const [tab, setTab] = useState<Tab>('overview')
  const [stats, setStats] = useState(loadStats)
  const [tip, setTip] = useState<Tip | null>(null)
  const [goal, setGoal] = useState(loadGoal)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  // quill-reading-features:selected-day-state

  // 每次打开都重新读，免得看到的是上次的快照
  useEffect(() => {
    if (open) setStats(loadStats())
  }, [open])
  useEffect(() => {
    setSelectedDay(null)
  }, [range, tab, open])
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open, onClose])

  const now = Date.now()
  const points = useMemo(() => lastDays(stats, range, now), [stats, range]) // eslint-disable-line react-hooks/exhaustive-deps
  const sum = useMemo(() => summarize(points), [points])
  const st = useMemo(() => streaks(stats, now), [stats]) // eslint-disable-line react-hooks/exhaustive-deps
  const hours = useMemo(() => hourTotals(stats, range, now), [stats, range]) // eslint-disable-line react-hooks/exhaustive-deps
  const weekdays = useMemo(() => weekdayTotals(points), [points])
  const books = useMemo(() => booksInRange(stats, range, now), [stats, range]) // eslint-disable-line react-hooks/exhaustive-deps
  const empty = Object.keys(stats.days).length === 0

  if (!open) return null

  const show = (e: { currentTarget: HTMLElement }, text: string) => {
    const r = e.currentTarget.getBoundingClientRect()
    setTip({ x: r.left + r.width / 2, y: r.top, text })
  }
  const tipProps = (text: string) => ({
    onMouseEnter: (e: { currentTarget: HTMLElement }) => show(e, text),
    onMouseLeave: () => setTip(null),
  })

  /** 深浅分四档：相对范围内最大值，0 单独一档（空心） */
  const level = (secs: number, max: number) => (secs <= 0 ? 0 : Math.min(4, Math.ceil((secs / max) * 4)))

  const Bars = ({ values, labels, caption, onSelect }: {
    values: number[]
    labels: string[]
    caption: (i: number) => string
    onSelect?: (index: number) => void
  }) => {
    const max = Math.max(1, ...values)
    return (
      <div className="stats-bars" style={{ ['--n' as string]: values.length }}>
        {values.map((v, i) => (
          <div
            key={i}
            className={'stats-bar-col' + (onSelect ? ' pickable' : '')}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={onSelect ? caption(i) + '，点击查看当天书目' : undefined}
            onClick={onSelect ? () => onSelect(i) : undefined}
            onKeyDown={onSelect ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(i) }
            } : undefined}
            {...tipProps(caption(i))}
          >
            <div className="stats-bar" style={{ height: `${Math.max(v > 0 ? 3 : 0, (v / max) * 100)}%` }} />
            <span className="stats-bar-label">{labels[i]}</span>
          </div>
        ))}
      </div>
    )
  }

  // 总览的柱状图：≤90 天逐日；一年的按周合并，不然 365 根柱子挤不下
  const overviewBars = (() => {
    if (range <= 90) {
      return {
        values: points.map((p) => p.secs),
        labels: points.map((p, i) => (i === 0 || i === points.length - 1 || (range <= 30 && i % 5 === 0) ? p.key.slice(5) : '')),
        caption: (i: number) => `${points[i].key} · ${points[i].secs ? fmtDuration(points[i].secs) : '没读'}`,
      }
    }
    const weeks: { from: string; to: string; secs: number }[] = []
    for (let i = 0; i < points.length; i += 7) {
      const chunk = points.slice(i, i + 7)
      weeks.push({ from: chunk[0].key, to: chunk[chunk.length - 1].key, secs: chunk.reduce((s, p) => s + p.secs, 0) })
    }
    return {
      values: weeks.map((w) => w.secs),
      labels: weeks.map((w, i) => (i % 8 === 0 ? w.from.slice(5) : '')),
      caption: (i: number) => `${weeks[i].from} ~ ${weeks[i].to} · ${weeks[i].secs ? fmtDuration(weeks[i].secs) : '没读'}`,
    }
  })()

  // 日历热力图：按周分列，周日在上。前面补空格让第一列对齐星期
  const calendar = (() => {
    const lead = points[0]?.weekday ?? 0
    const cells: (DayPoint | null)[] = [...new Array<null>(lead).fill(null), ...points]
    const max = Math.max(1, ...points.map((p) => p.secs))
    return { cells, max }
  })()

  const selectedBooks = selectedDay ? booksOnDay(stats, selectedDay) : []
  const dayDetail = selectedDay ? (
    <section className="stats-day-detail" aria-live="polite">
      <div className="stats-day-head">
        <b>{selectedDay}</b>
        <span>{fmtDuration(stats.days[selectedDay]?.secs ?? 0)}</span>
        <button className="btn ghost mini" onClick={() => setSelectedDay(null)}>收起</button>
      </div>
      {selectedBooks.length ? (
        <div className="stats-day-books">
          {selectedBooks.map((book) => (
            <div className="stats-day-book" key={book.id}>
              <span>{book.title}</span><b>{fmtDuration(book.secs)}</b>
            </div>
          ))}
        </div>
      ) : <div className="stats-day-empty">这一天没有按书拆分的阅读记录。</div>}
    </section>
  ) : null

  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className="modal stats-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>阅读统计</span>
          <button className="btn ghost icon" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        <div className="stats-toolbar">
          <div className="stats-seg" role="tablist" aria-label="视图">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? 'on' : ''}
                onClick={() => setTab(t.id)}
              >
                {t.name}
              </button>
            ))}
          </div>
          <span className="grow" />
          <div className="stats-seg" role="radiogroup" aria-label="日期范围">
            {RANGES.map((r) => (
              <button
                key={r}
                role="radio"
                aria-checked={range === r}
                className={range === r ? 'on' : ''}
                onClick={() => setRange(r)}
              >
                {r === 365 ? '1 年' : `${r} 天`}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-body stats-body">
          {empty ? (
            <div className="stats-empty">
              还没有阅读记录。
              <br />
              在阅读视图里读一会儿，这里就会出现你的阅读时间、节律和读过的书。
              <br />
              <small>只在窗口在前台、有操作时计时；挂机 30 秒后暂停。数据只存在这台电脑上。</small>
            </div>
          ) : tab === 'overview' ? (
            <>
              <div className="stats-goal">
                <div className="stats-goal-head">
                  <span>每日目标</span>
                  <GoalPicker
                    goal={goal}
                    onChange={(m) => {
                      saveGoal(m)
                      setGoal(m)
                    }}
                  />
                </div>
                {goal > 0 && (
                  <div className="stats-goal-body">
                    {(() => {
                      const secsToday = stats.days[dayKey(now)]?.secs ?? 0
                      const g = goalProgress(secsToday, goal)
                      const n = goalStreak(stats.days, goal, now)
                      return (
                        <>
                          <div className="stats-goal-bar" aria-hidden="true">
                            <i style={{ width: `${Math.round(g.frac * 100)}%` }} />
                          </div>
                          <span>
                            今天 {Math.round(secsToday / 60)} / {goal} 分钟
                            {g.done ? ' · 已达成' : ` · 还差 ${g.leftMin} 分钟`}
                            {n > 0 ? ` · 连续达标 ${n} 天` : ''}
                          </span>
                        </>
                      )
                    })()}
                  </div>
                )}
              </div>
              <div className="stats-tiles">
                <div className="stats-tile">
                  <b>{fmtDuration(sum.secs)}</b>
                  <span>阅读时长</span>
                </div>
                <div className="stats-tile">
                  <b>{fmtDuration(sum.avgSecs)}</b>
                  <span>日均</span>
                </div>
                <div className="stats-tile">
                  <b>
                    {sum.activeDays}
                    <small> / {range} 天</small>
                  </b>
                  <span>活跃天数</span>
                </div>
                <div className="stats-tile">
                  <b>
                    {st.current}
                    <small> 天</small>
                  </b>
                  <span>当前连续 · 最长 {st.longest} 天</span>
                </div>
              </div>
              <div className="stats-h">{range <= 90 ? '每日阅读' : '每周阅读'}</div>
              <Bars
                values={overviewBars.values}
                labels={overviewBars.labels}
                caption={overviewBars.caption}
                onSelect={range <= 90 ? (i) => setSelectedDay(points[i].key) : undefined}
              />
              {dayDetail}
              {sum.bestDay && (
                <div className="stats-note">
                  读得最多的一天是 {sum.bestDay.key}，{fmtDuration(sum.bestDay.secs)}。
                </div>
              )}
            </>
          ) : tab === 'rhythm' ? (
            <>
              <div className="stats-h">阅读日历</div>
              <div className="stats-cal-wrap">
                <div className="stats-cal-weeks" aria-hidden>
                  {WEEK.map((w, i) => (
                    <span key={w} style={{ visibility: i % 2 === 1 ? 'visible' : 'hidden' }}>
                      {w}
                    </span>
                  ))}
                </div>
                <div className="stats-cal">
                  {calendar.cells.map((c, i) =>
                    c ? (
                      <i
                        key={c.key}
                        className={`stats-cell l${level(c.secs, calendar.max)}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${c.key} 周${WEEK[c.weekday]} · ${c.secs ? fmtDuration(c.secs) : '没读'}，点击查看当天书目`}
                        onClick={() => setSelectedDay(c.key)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedDay(c.key) } }}
                        {...tipProps(`${c.key} 周${WEEK[c.weekday]} · ${c.secs ? fmtDuration(c.secs) : '没读'}`)}
                      />
                    ) : (
                      <i key={`p${i}`} className="stats-cell pad" />
                    ),
                  )}
                </div>
              </div>
              <div className="stats-legend">
                少<i className="stats-cell l0" />
                <i className="stats-cell l1" />
                <i className="stats-cell l2" />
                <i className="stats-cell l3" />
                <i className="stats-cell l4" />多
              </div>
              {dayDetail}

              <div className="stats-h">一天里什么时候读</div>
              <Bars
                values={hours}
                labels={hours.map((_, h) => (h % 6 === 0 ? `${h}时` : ''))}
                caption={(h) => `${h}:00–${h + 1}:00 · ${hours[h] ? fmtDuration(hours[h]) : '没读'}`}
              />

              <div className="stats-h">星期几读得多</div>
              <Bars
                values={weekdays}
                labels={WEEK.map((w) => `周${w}`)}
                caption={(i) => `周${WEEK[i]} · ${weekdays[i] ? fmtDuration(weekdays[i]) : '没读'}`}
              />
            </>
          ) : (
            <>
              <div className="stats-h">范围内读过的书</div>
              {books.length ? (
                <div className="stats-books">
                  {books.map((b) => (
                    <div className="stats-book" key={b.id}>
                      <div className="stats-book-title">
                        {b.title}
                        {b.done ? <em className="stats-done">已读完</em> : null}
                      </div>
                      <div className="stats-book-meta">
                        <span>本期 {fmtDuration(b.rangeSecs)}</span>
                        <span>累计 {fmtDuration(b.secs)}</span>
                        <span>首读 {dateText(b.first)}</span>
                        {b.done ? <span>读完 {dateText(b.done)}</span> : <span>最近 {dateText(b.last)}</span>}
                      </div>
                      <div className="stats-book-bar">
                        <i style={{ width: `${Math.max(3, (b.rangeSecs / books[0].rangeSecs) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="stats-empty">这段时间没有读书记录。</div>
              )}
            </>
          )}
        </div>

        {!empty && (
          <div className="stats-foot">
            <span>只存在这台电脑上，不进文档仓库。</span>
            <span className="grow" />
            <button
              className="btn ghost mini"
              onClick={() => {
                if (window.confirm('清空全部阅读统计？这个操作不能撤销。')) {
                  clearStats()
                  setStats(loadStats())
                }
              }}
            >
              清空统计
            </button>
          </div>
        )}
      </div>
      {tip && (
        <div className="stats-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
          {tip.text}
        </div>
      )}
    </div>
  )
}
