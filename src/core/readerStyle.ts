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
import { useCallback, useEffect, useState } from 'react'
import { getBookStyle, setBookStyle } from './bookStyle'
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
  /** 纸张主题的纸纹（纤维颗粒 + 书页边缘暗角） */
  paperTex: boolean
  /** 字重：400 常规 / 500 / 600 / 700。只对带多字重的字体有效果，单字重字体会被浏览器合成加粗 */
  weight: 400 | 500 | 600 | 700
  /** 字距（em） */
  track: number
  /** 竖排（从右到左、从上到下，翻页方向也跟着反过来）；竖排下栏数不起作用 */
  vertical: boolean
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
  minTrack: -0.02,
  maxTrack: 0.2,
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
    paperTex: true,
    weight: 400,
    track: 0,
    vertical: false,
  }
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo)

/** 把存下来的（可能缺键、可能被改坏的）对象规整成合法样式；缺的用 d 补 */
export function normalizeStyle(o: Partial<ReaderStyle>, d: ReaderStyle): ReaderStyle {
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
    paperTex: typeof o.paperTex === 'boolean' ? o.paperTex : d.paperTex,
    weight: typeof o.weight === 'number' ? o.weight : d.weight,
    track: typeof o.track === 'number' ? o.track : d.track,
    vertical: typeof o.vertical === 'boolean' ? o.vertical : d.vertical,
  }
}

/** 读存下来的设置；缺的键用默认补，存坏了也不崩 */
export function readReaderStyle(): ReaderStyle {
  const d = defaultReaderStyle()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return d
    return normalizeStyle(JSON.parse(raw) as Partial<ReaderStyle>, d)
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
    '--r-weight': String(s.weight),
    // 竖排的行距网格：每一行（竖排里是一列）的厚度，取整才能让一页刚好装整数列
    '--r-pitch': `${pitchOf(s)}px`,
    '--r-track': `${s.track}em`,
    '--r-rule': s.rule ? '1px solid var(--border)' : 'none',
    '--r-speed': String(TURN_SPEEDS.find((t) => t.id === s.speed)?.scale ?? 1),
  }
}

/** 竖排时一列的厚度（px，取整） */
export function pitchOf(s: Pick<ReaderStyle, 'size' | 'leading'>): number {
  return Math.max(1, Math.round(s.size * s.leading))
}

/** 影响分页的那几项拼成一个签名：变了就得重新量页数 */
export function layoutSig(s: ReaderStyle): string {
  return [s.font, s.size, s.leading, s.gap, s.indent, s.justify, s.margin, s.cols, s.rule, s.weight, s.track, s.vertical].join('|')
}

export interface BookStyleCtl {
  /** 当前这本书是否有专属排版 */
  perBook: boolean
  setPerBook: (on: boolean) => void
}

/**
 * 阅读样式：默认全局一份；打开「仅这本书」后这本单独存，
 * 之后在这本里的调整只影响它，别的书不动。关掉即回到全局。
 */
export function useReaderStyle(docId?: string): [ReaderStyle, (next: ReaderStyle) => void, BookStyleCtl] {
  const [global, setGlobal] = useState<ReaderStyle>(() => {
    const s = readReaderStyle()
    ensureFont(fontOption(s.font).id)
    return s
  })
  const load = useCallback((): ReaderStyle | null => {
    if (!docId) return null
    try {
      const raw = getBookStyle(localStorage, docId)
      return raw && typeof raw === 'object' ? normalizeStyle(raw as Partial<ReaderStyle>, readReaderStyle()) : null
    } catch {
      return null
    }
  }, [docId])
  const [own, setOwn] = useState<ReaderStyle | null>(load)
  // 切到另一本书：换它自己的设置
  useEffect(() => {
    const o = load()
    setOwn(o)
    if (o) ensureFont(fontOption(o.font).id)
  }, [load])

  const set = useCallback(
    (next: ReaderStyle) => {
      ensureFont(fontOption(next.font).id)
      if (own && docId) {
        setOwn(next)
        setBookStyle(localStorage, docId, next)
        return
      }
      setGlobal(next)
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* 写不进去只是记不住 */
      }
    },
    [own, docId],
  )
  const setPerBook = useCallback(
    (on: boolean) => {
      if (!docId) return
      if (on) {
        setOwn(global)
        setBookStyle(localStorage, docId, global)
      } else {
        setOwn(null)
        setBookStyle(localStorage, docId, null)
      }
    },
    [docId, global],
  )
  return [own ?? global, set, { perBook: own !== null, setPerBook }]
}
