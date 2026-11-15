import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocMeta } from '../core/types'
import { Icon } from './Icon'

/**
 * 立体书架：文档排成一圈书，当前这本在正中，两侧透视着退开。
 *
 * 手感（自己实现，参考的是「循环轮播 + 惯性 + 吸附」这个交互思路）：
 *   · 拖动 / 滚轮 / 方向键翻书，首尾相接，可以一直转
 *   · 松手带惯性：按松手时的速度估一个落点，再缓动吸附到最近的一本
 *   · 点两侧的书：滑到中间；点中间那本：打开
 *
 * 位置用一个连续的 pos（单位：本）表示，第 i 本相对中心的偏移是
 * d = wrap(i - pos)。所有 3D 变换都只由 d 算出来，没有任何额外状态。
 */

interface Props {
  docs: DocMeta[]
  currentId: string | null
  onOpen: (id: string) => void
  onStar: (id: string, starred: boolean) => void
}

/** 拖多少像素算翻一本 */
const DRAG_PX_PER_BOOK = 170
/** 惯性的「滑行时间常数」（毫秒）：松手速度 × 它 ≈ 还会再滑多远 */
const GLIDE_MS = 320
/** 最多渲染中心左右各这么多本，再远的看不见，不画 */
const VISIBLE = 4.2

/** 把差值折到 [-n/2, n/2)，实现首尾相接 */
function wrap(d: number, n: number): number {
  return ((((d + n / 2) % n) + n) % n) - n / 2
}
const mod = (a: number, n: number) => ((a % n) + n) % n

/** 封面色：由 id 稳定地挑一个偏冷、低饱和的色相，别让书架花成一片 */
const HUES = [188, 202, 218, 236, 256, 276, 160, 14, 32]
function coverHue(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return HUES[h % HUES.length]
}

function shortDate(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
}
function sizeLabel(n?: number): string {
  if (!n) return '空白'
  return n < 1000 ? `${n} 字` : `${(n / 1000).toFixed(1)}k 字`
}

/** 系统要求减少动效、且用户在设置里选了跟随时，翻书不做滑动动画 */
function motionReduced(): boolean {
  try {
    return (
      document.documentElement.classList.contains('respect-motion') &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
  } catch {
    return false
  }
}

export default function Bookshelf3D({ docs, currentId, onOpen, onStar }: Props) {
  const n = docs.length
  const [pos, setPos] = useState(() => Math.max(0, docs.findIndex((d) => d.id === currentId)))
  const posRef = useRef(pos)
  const raf = useRef(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const wheelTimer = useRef<number | undefined>(undefined)
  const suppressClick = useRef(false)
  const drag = useRef<{
    x: number
    pos0: number
    moved: boolean
    lastX: number
    lastT: number
    v: number
  } | null>(null)

  const put = useCallback((v: number) => {
    posRef.current = v
    setPos(v)
  }, [])
  const stop = useCallback(() => cancelAnimationFrame(raf.current), [])

  /** 缓动滑到 target（单位：本）。target 不必是整数，但落点总会是整数 */
  const glideTo = useCallback(
    (target: number, ms = 380) => {
      stop()
      if (motionReduced() || ms <= 0) {
        put(target)
        return
      }
      const from = posRef.current
      const t0 = performance.now()
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / ms)
        const e = 1 - Math.pow(1 - k, 3)
        put(from + (target - from) * e)
        if (k < 1) raf.current = requestAnimationFrame(step)
      }
      raf.current = requestAnimationFrame(step)
    },
    [put, stop],
  )

  // 文档数量变了（筛选、搜索）：回到合法范围，别停在空处
  useEffect(() => {
    if (n === 0) return
    const i = Math.round(posRef.current)
    if (i < 0 || i >= n) put(mod(i, n))
  }, [n, put])

  useEffect(() => () => stop(), [stop])

  // 滚轮要 preventDefault，React 的 onWheel 是被动监听，只能自己挂
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (n < 2) return
      e.preventDefault()
      stop()
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      put(posRef.current + delta / 280)
      window.clearTimeout(wheelTimer.current)
      wheelTimer.current = window.setTimeout(() => glideTo(Math.round(posRef.current), 260), 140)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      window.clearTimeout(wheelTimer.current)
    }
  }, [n, put, stop, glideTo])

  if (n === 0) return <div className="shelf-empty">没有符合条件的文档</div>

  const centerIdx = mod(Math.round(pos), n)
  const center = docs[centerIdx]

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || n < 2) return
    stop()
    window.clearTimeout(wheelTimer.current)
    drag.current = {
      x: e.clientX,
      pos0: posRef.current,
      moved: false,
      lastX: e.clientX,
      lastT: performance.now(),
      v: 0,
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const g = drag.current
    if (!g) return
    const dx = e.clientX - g.x
    if (!g.moved && Math.abs(dx) > 5) {
      g.moved = true
      try {
        stageRef.current?.setPointerCapture(e.pointerId)
      } catch {
        /* 抓不到指针也能拖，只是拖出窗口外会丢 */
      }
    }
    if (!g.moved) return
    const now = performance.now()
    const dt = Math.max(1, now - g.lastT)
    // 速度（本/毫秒）做一点平滑，免得最后一帧抖一下就甩飞
    g.v = g.v * 0.6 + (-(e.clientX - g.lastX) / DRAG_PX_PER_BOOK / dt) * 0.4
    g.lastX = e.clientX
    g.lastT = now
    put(g.pos0 - dx / DRAG_PX_PER_BOOK)
  }
  const endDrag = () => {
    const g = drag.current
    drag.current = null
    if (!g || !g.moved) return
    suppressClick.current = true
    window.setTimeout(() => (suppressClick.current = false), 0)
    // 停了一会儿才松手 = 没有速度
    const idle = performance.now() - g.lastT
    const v = idle > 90 ? 0 : g.v
    const target = Math.round(posRef.current + v * GLIDE_MS)
    glideTo(target, 320 + Math.min(520, Math.abs(target - posRef.current) * 130))
  }

  const step = (dir: 1 | -1) => glideTo(Math.round(posRef.current) + dir, 360)

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      step(-1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      step(1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(center.id)
    }
  }

  return (
    <div className="shelf">
      <div
        ref={stageRef}
        className="shelf-stage"
        tabIndex={0}
        role="listbox"
        aria-label="立体书架：左右键翻书，回车打开"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <div className="shelf-floor" aria-hidden="true" />
        <div className="shelf-track">
          {docs.map((d, i) => {
            const off = n > 1 ? wrap(i - pos, n) : 0
            const a = Math.abs(off)
            if (a > VISIBLE) return null
            const side = Math.sign(off)
            const rot = Math.max(-62, Math.min(62, -off * 44))
            const tx = side * (Math.min(a, 1) * 196 + Math.max(0, a - 1) * 84)
            const tz = -Math.min(a, 1) * 70 - Math.max(0, Math.min(a, 3.5) - 1) * 120
            const sc = 1 - Math.min(a, 3) * 0.04
            const fade = a > 3 ? Math.max(0, 1 - (a - 3) / 1.2) : 1
            const hue = coverHue(d.id)
            const isCenter = i === centerIdx
            return (
              <div
                key={d.id}
                className={'book' + (isCenter ? ' is-center' : '') + (d.id === currentId ? ' is-current' : '')}
                style={
                  {
                    transform: `translate3d(${tx}px, 0, ${tz}px) rotateY(${rot}deg) scale(${sc})`,
                    opacity: fade,
                    zIndex: 100 - Math.round(a * 10),
                    '--hue': hue,
                  } as React.CSSProperties
                }
                role="option"
                aria-selected={isCenter}
                onClick={() => {
                  if (suppressClick.current) return
                  if (isCenter) onOpen(d.id)
                  else glideTo(posRef.current + Math.round(off), 420)
                }}
              >
                <div className="book-cover">
                  <span className="book-spine" aria-hidden="true" />
                  <div className="book-label">NO.{String(i + 1).padStart(2, '0')}</div>
                  <div className="book-title">{d.title || '未命名'}</div>
                  <div className="book-foot">
                    <span>{sizeLabel(d.chars)}</span>
                    <span>{shortDate(d.updatedAt)}</span>
                  </div>
                  {d.starred && (
                    <span className="book-star" aria-label="已星标">
                      <Icon name="star" filled />
                    </span>
                  )}
                  {d.id === currentId && <span className="book-ribbon">正在写</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="shelf-info">
        <button className="btn ghost icon" onClick={() => step(-1)} title="上一本（←）" disabled={n < 2}>
          <Icon name="chevleft" />
        </button>
        <div className="shelf-meta">
          <div className="shelf-count">
            {String(centerIdx + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}
          </div>
          <div className="shelf-name" title={center.title}>
            {center.title || '未命名'}
          </div>
          <div className="shelf-sub">
            {sizeLabel(center.chars)} · 修改于 {shortDate(center.updatedAt)}
            {(center.tags ?? []).slice(0, 3).map((t) => (
              <span key={t} className="lr-tag">
                {t}
              </span>
            ))}
          </div>
        </div>
        <button
          className={'btn ghost icon' + (center.starred ? ' on' : '')}
          onClick={() => onStar(center.id, !center.starred)}
          title={center.starred ? '取消星标' : '加星标'}
        >
          <Icon name="star" filled={center.starred} />
        </button>
        <button className="btn primary" onClick={() => onOpen(center.id)}>
          打开
        </button>
        <button className="btn ghost icon" onClick={() => step(1)} title="下一本（→）" disabled={n < 2}>
          <Icon name="chevright" />
        </button>
      </div>
      <div className="shelf-hint">拖动 · 滚轮 · ← → 翻书　点中间那本打开</div>
    </div>
  )
}
