/**
 * 阅读视图自己的外观：配色主题 + 排版，**独立于编辑器**。
 *
 * 写作时要的是紧凑的工作字号，读小说要的是舒服的书页 ——
 * 两者共用一份设置，调了这边坏了那边。所以阅读视图单独存一份，
 * 只以 CSS 变量的形式挂在 `.reader` 根节点上，不碰 <html>，
 * 编辑器、便签、桌面磁贴都不受影响。
 *
 * 字体 / 字号 / 行距的**初值**取编辑器当前设置：第一次打开阅读视图时观感不变，
 * 动过一次才开始各走各的。
 */
import { useCallback, useState } from 'react'
import { ensureFont, fontOption, readProse } from './fonts'
import {
  PAGE_TURNS,
  TAP_LAYOUTS,
  TURN_SPEEDS,
  type PageTurn,
  type TapLayout,
  type TurnSpeed,
} from './pageTurn'

export { PAGE_TURNS, TAP_LAYOUTS, TURN_SPEEDS, tapAction } from './pageTurn'
export type { PageTurn, TapLayout, TurnSpeed } from './pageTurn'

export type ReaderTheme = 'glass' | 'paper' | 'green' | 'dark'

export const READER_THEMES: { id: ReaderTheme; name: string; swatch: string }[] = [
  { id: 'glass', name: '玻璃', swatch: 'linear-gradient(135deg,#dfeef0,#9bc7cf)' },
  { id: 'paper', name: '纸张', swatch: '#f3ead7' },
  { id: 'green', name: '护眼', swatch: '#d9e8d2' },
  { id: 'dark', name: '夜间', swatch: '#15181d' },
]

export interface ReaderStyle {
  theme: ReaderTheme
  font: string
  size: number
  leading: number
  /** 段距（em） */
  gap: number
  /** 首行缩进（字） */
  indent: number
  justify: boolean
  /** 左右留白（px） */
  margin: number
  /** 栏数：auto 随窗口宽度（窄 1 栏 / 宽 2 栏 / 超宽 3 栏），或固定 1/2/3（窄窗口始终单栏） */
  cols: 'auto' | 1 | 2 | 3
  /** 栏与栏之间的竖线 */
  rule: boolean
  /** 翻页动画：滑动 / 淡入 / 书页翻折 / 无 */
  turn: PageTurn
  /** 翻页速度：慢 / 标准 / 快（点按、键盘、滚轮、自动翻页都用；手指拖动始终跟手） */
  speed: TurnSpeed
  /** 点按分区布局 */
  tap: TapLayout
}



export const READER_RANGE = {
  minSize: 14,
  maxSize: 30,
  minLeading: 1.4,
  maxLeading: 2.6,
  minGap: 0,
  maxGap: 1.6,
  maxIndent: 4,
  minMargin: 12,
  maxMargin: 140,
}

const KEY = 'quill-set:readerStyle'

export function defaultReaderStyle(): ReaderStyle {
  const p = readProse()
  return {
    theme: 'glass',
    font: p.font,
    size: p.size,
    leading: p.leading,
    gap: 0.85,
    indent: 2,
    justify: false,
    margin: 44,
    cols: 2,
    rule: true,
    turn: 'slide',
    speed: 'normal',
    tap: 'standard',
  }
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo)

/** 读存下来的设置；缺的键用默认补，存坏了也不崩 */
export function readReaderStyle(): ReaderStyle {
  const d = defaultReaderStyle()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return d
    const o = JSON.parse(raw) as Partial<ReaderStyle>
    const R = READER_RANGE
    return {
      theme: READER_THEMES.some((t) => t.id === o.theme) ? (o.theme as ReaderTheme) : d.theme,
      font: typeof o.font === 'string' ? o.font : d.font,
      size: clamp(o.size ?? d.size, R.minSize, R.maxSize),
      leading: clamp(o.leading ?? d.leading, R.minLeading, R.maxLeading),
      gap: clamp(o.gap ?? d.gap, R.minGap, R.maxGap),
      indent: clamp(o.indent ?? d.indent, 0, R.maxIndent),
      justify: typeof o.justify === 'boolean' ? o.justify : d.justify,
      margin: clamp(o.margin ?? d.margin, R.minMargin, R.maxMargin),
      cols: o.cols === 'auto' || o.cols === 1 || o.cols === 2 || o.cols === 3 ? o.cols : d.cols,
      rule: typeof o.rule === 'boolean' ? o.rule : d.rule,
      turn: PAGE_TURNS.some((t) => t.id === o.turn) ? (o.turn as PageTurn) : d.turn,
      speed: TURN_SPEEDS.some((t) => t.id === o.speed) ? (o.speed as TurnSpeed) : d.speed,
      tap: TAP_LAYOUTS.some((t) => t.id === o.tap) ? (o.tap as TapLayout) : d.tap,
    }
  } catch {
    return d
  }
}

/** 样式 → 挂在 .reader 上的内联 CSS 变量 */
export function readerVars(s: ReaderStyle): Record<string, string> {
  return {
    '--font-prose': fontOption(s.font).stack,
    '--prose-size': `${s.size}px`,
    '--prose-leading': String(s.leading),
    '--r-gap': `${s.gap}em`,
    '--r-indent': `${s.indent}em`,
    '--r-align': s.justify ? 'justify' : 'start',
    '--r-margin': `${s.margin}px`,
    '--r-rule': s.rule ? '1px solid var(--border)' : 'none',
    '--r-speed': String(TURN_SPEEDS.find((t) => t.id === s.speed)?.scale ?? 1),
  }
}

/** 影响分页的那几项拼成一个签名：变了就得重新量页数 */
export function layoutSig(s: ReaderStyle): string {
  return [s.font, s.size, s.leading, s.gap, s.indent, s.justify, s.margin, s.cols, s.rule].join('|')
}

export function useReaderStyle(): [ReaderStyle, (next: ReaderStyle) => void] {
  const [style, setStyle] = useState<ReaderStyle>(() => {
    const s = readReaderStyle()
    ensureFont(fontOption(s.font).id)
    return s
  })
  const set = useCallback((next: ReaderStyle) => {
    setStyle(next)
    ensureFont(fontOption(next.font).id)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* 写不进去只是记不住 */
    }
  }, [])
  return [style, set]
}
