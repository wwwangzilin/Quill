/**
 * 写作目标的进度环（底栏用）：比一条 3px 的细线更看得清，也有地方放「达成」的动效。
 * 画法：两个同心圆，进度圆用 pathLength=100 把周长归一化，所以 dasharray 直接写百分比。
 * 达成（done）时挂 .done，样式里有一圈光向外扩散（styles/36-texture.css）。
 */
export default function GoalRing({ ratio, done }: { ratio: number; done: boolean }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100
  return (
    <svg className={'goal-ring' + (done ? ' done' : '')} width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      <circle className="goal-track" cx="10" cy="10" r="7.5" fill="none" strokeWidth="2.6" />
      <circle
        className="goal-fill"
        cx="10"
        cy="10"
        r="7.5"
        fill="none"
        strokeWidth="2.6"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={`${pct} 100`}
        transform="rotate(-90 10 10)"
      />
      {done && <path className="goal-tick" d="M6.6 10.2l2.4 2.4 4.4-4.9" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  )
}
