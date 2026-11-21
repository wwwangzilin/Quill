/**
 * 性能设置：玻璃模糊、质感层（颗粒/聚光/高光）、动效、3D 书架，各自能单独关。
 * 状态贴在 <html> 的 class 上，样式见 styles/37-perf.css；
 * 「低性能模式」只是把四项一起关掉的快捷方式，不另存状态。
 *
 * 和主题、动效一样，所有窗口渲染前都要调 initPerf()。
 */
import { useEffect, useState } from 'react'

export interface Perf {
  /** 毛玻璃背景模糊（backdrop-filter，最吃 GPU 的一项） */
  blur: boolean
  /** 颗粒、顶部高光、鼠标聚光 */
  texture: boolean
  /** 过渡与动画 */
  motion: boolean
  /** 侧栏 3D 书架 */
  shelf: boolean
}

export const PERF_FULL: Perf = { blur: true, texture: true, motion: true, shelf: true }
export const PERF_LITE: Perf = { blur: false, texture: false, motion: false, shelf: false }

const KEY = 'quill-perf'
const EVENT = 'quill-perf-change'

export function readPerf(): Perf {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...PERF_FULL }
    const o = JSON.parse(raw) as Partial<Perf>
    return {
      blur: o.blur !== false,
      texture: o.texture !== false,
      motion: o.motion !== false,
      shelf: o.shelf !== false,
    }
  } catch {
    return { ...PERF_FULL }
  }
}

function paint(p: Perf): void {
  const c = document.documentElement.classList
  c.toggle('perf-no-blur', !p.blur)
  c.toggle('perf-no-texture', !p.texture)
  c.toggle('perf-no-motion', !p.motion)
}

export function applyPerf(p: Perf): void {
  paint(p)
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* 写不进去只是记不住 */
  }
  window.dispatchEvent(new Event(EVENT))
}

export function initPerf(): void {
  paint(readPerf())
}

export function isLite(p: Perf): boolean {
  return !p.blur && !p.texture && !p.motion && !p.shelf
}

/** 订阅性能设置（设置页改了，侧栏等地方立刻跟着变） */
export function usePerf(): Perf {
  const [p, setP] = useState(readPerf)
  useEffect(() => {
    const on = () => setP(readPerf())
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  return p
}
