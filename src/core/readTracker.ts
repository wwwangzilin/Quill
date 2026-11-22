import { useEffect, useRef } from 'react'
import { IDLE_MS, addReading, loadStats, markFinished, saveStats } from './readStats'

const TICK_MS = 5000

/**
 * 阅读计时。每 5 秒看一眼：窗口在前台、最近 30 秒内有过操作，才记这 5 秒。
 *
 * 自动翻页开着时人可能一动不动地在读，所以允许调用方声明「现在算在读」（keepAlive）。
 * 每次都从 localStorage 现读现写，而不是在内存里攒着 —— 主窗口和便签窗口
 * 是两个页面，各自攒会互相覆盖；5 秒一次的读写量可以忽略。
 */
export function useReadingTracker(docId: string, title: string, keepAlive: () => boolean): void {
  const keep = useRef(keepAlive)
  keep.current = keepAlive
  const meta = useRef({ docId, title })
  meta.current = { docId, title }

  useEffect(() => {
    if (!docId) return
    let lastActive = Date.now()
    let last = Date.now()
    const bump = () => {
      lastActive = Date.now()
    }
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }))

    const timer = window.setInterval(() => {
      const now = Date.now()
      // 页面被挂起再恢复时 now - last 会很大，封顶一个 tick，别一下子记几十分钟
      const dt = Math.min(now - last, TICK_MS + 1000)
      last = now
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return
      if (now - lastActive > IDLE_MS && !keep.current()) return
      const m = meta.current
      saveStats(addReading(loadStats(), { docId: m.docId, title: m.title, at: now - dt, secs: dt / 1000 }))
    }, TICK_MS)

    return () => {
      window.clearInterval(timer)
      events.forEach((e) => window.removeEventListener(e, bump))
    }
  }, [docId])
}

/** 读到最后一页：记一次「读完」 */
export function recordFinished(docId: string, title: string): void {
  if (!docId) return
  const s = loadStats()
  const next = markFinished(s, docId, title, Date.now())
  if (next !== s) saveStats(next)
}
