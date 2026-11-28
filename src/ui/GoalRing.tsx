import { useEffect, useState } from 'react'
import { GOAL_PRESETS, goalProgress, goalStreak, loadGoal, saveGoal } from '../core/readGoal'
import { loadStats } from '../core/readStats'
import { dayKey } from '../core/readStats'

const R = 9
const C = 2 * Math.PI * R

/** 目标选择：几个预设 + 关闭。阅读器里的环和统计页都用它 */
export function GoalPicker({ goal, onChange }: { goal: number; onChange: (m: number) => void }) {
  return (
    <div className="goal-picker" role="radiogroup" aria-label="每日阅读目标">
      <button type="button" role="radio" aria-checked={goal === 0} className={goal === 0 ? 'on' : ''} onClick={() => onChange(0)}>
        不设
      </button>
      {GOAL_PRESETS.map((m) => (
        <button key={m} type="button" role="radio" aria-checked={goal === m} className={goal === m ? 'on' : ''} onClick={() => onChange(m)}>
          {m} 分钟
        </button>
      ))}
    </div>
  )
}

/** 今日读了多少秒（现读 localStorage：计时器每 5 秒写一次） */
export function todaySecs(now = Date.now()): number {
  return loadStats().days[dayKey(now)]?.secs ?? 0
}

/**
 * 阅读器顶栏的「今日目标」小环：读满一圈 = 今天的目标达成。
 * 点开可以改目标。没设目标时是一个空环，提示可以设。
 */
export default function GoalRing() {
  const [goal, setGoal] = useState(loadGoal)
  const [secs, setSecs] = useState(todaySecs)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const id = window.setInterval(() => setSecs(todaySecs()), 15_000)
    return () => window.clearInterval(id)
  }, [])

  const p = goalProgress(secs, goal)
  const streak = goal ? goalStreak(loadStats().days, goal, Date.now()) : 0
  const tip = goal
    ? p.done
      ? `今日目标已达成 · 已读 ${Math.round(secs / 60)} 分钟${streak > 1 ? ` · 连续 ${streak} 天` : ''}`
      : `今日目标 ${goal} 分钟 · 还差 ${p.leftMin} 分钟${streak ? ` · 已连续 ${streak} 天` : ''}`
    : '设置每日阅读目标'

  return (
    <span className="goal-ring-wrap">
      <button className={'btn ghost icon goal-ring' + (p.done ? ' done' : '')} onClick={() => setOpen((v) => !v)} title={tip} aria-expanded={open}>
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <circle cx="11" cy="11" r={R} className="goal-ring-bg" />
          <circle
            cx="11"
            cy="11"
            r={R}
            className="goal-ring-fg"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - p.frac)}
            transform="rotate(-90 11 11)"
          />
          {p.done && <path d="M7.5 11.2l2.4 2.4 4.6-4.8" className="goal-ring-tick" />}
        </svg>
      </button>
      {open && (
        <div className="goal-pop" onMouseDown={(e) => e.stopPropagation()}>
          <div className="goal-pop-title">每日阅读目标</div>
          <GoalPicker
            goal={goal}
            onChange={(m) => {
              saveGoal(m)
              setGoal(m)
            }}
          />
          <div className="goal-pop-tip">{tip}</div>
        </div>
      )}
    </span>
  )
}
