/**
 * 正文外观：字体 / 字号 / 行距。
 *
 * 做法很土但很稳——只往 <html> 上写三个 CSS 变量：
 *   --font-prose / --prose-size / --prose-leading
 * 主窗口、快捷便签、桌面磁贴都是同一份前端产物，所以一处设置三处生效。
 */

export interface FontOption {
  id: string
  /** 界面上显示的名字 */
  name: string
  /** 写进 CSS font-family 的值 */
  stack: string
  /** 用来问系统「这个字体装没装」的探测名 */
  probe: string
  /** 系统里没有时，从 CDN 现拉的 webfont CSS */
  cdn?: string
  hint?: string
}

const WENKAI_CSS =
  'https://cdn.jsdelivr.net/npm/lxgw-wenkai-lite-webfont@1.7.0/lxgwwenkailite-regular.css'
const INTER_CSS = 'https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.0.18/index.css'

export const FONTS: FontOption[] = [
  {
    id: 'system',
    name: '默认字体',
    stack: 'var(--font-ui)',
    probe: '',
    hint: '跟随系统界面字体，兼容性最好',
  },
  {
    id: 'wenkai',
    name: '霞鹜文楷 LXGW WenKai',
    stack: '"LXGW WenKai Lite", "LXGW WenKai", "LXGW WenKai Screen", var(--font-ui)',
    probe: '"LXGW WenKai Lite"',
    cdn: WENKAI_CSS,
    hint: '楷体笔意，适合长文阅读。首次选用会按需加载字形，只下载用到的字',
  },
  {
    id: 'inter',
    name: 'Inter',
    stack: '"Inter Variable", "Inter var", "Inter", var(--font-ui)',
    probe: '"Inter Variable"',
    cdn: INTER_CSS,
    hint: '西文与数字更利落，中文自动回退',
  },
  {
    id: 'yahei',
    name: '微软雅黑',
    stack: '"Microsoft YaHei", var(--font-ui)',
    probe: '"Microsoft YaHei"',
    hint: 'Windows 自带',
  },
  {
    id: 'pingfang',
    name: '苹方 / 黑体',
    stack: '"PingFang SC", "Heiti SC", "Microsoft YaHei", var(--font-ui)',
    probe: '"PingFang SC"',
    hint: 'macOS 自带，Windows 上会回退',
  },
  {
    id: 'songti',
    name: '宋体',
    stack: '"Songti SC", SimSun, "Noto Serif SC", serif',
    probe: 'SimSun',
    hint: '衬线字体，端端正正的印刷味',
  },
  {
    id: 'kaiti',
    name: '楷体',
    stack: '"Kaiti SC", KaiTi, STKaiti, serif',
    probe: 'KaiTi',
    hint: '手写感',
  },
  {
    id: 'mono',
    name: 'JetBrains Mono',
    stack: 'var(--font-mono)',
    probe: '"JetBrains Mono"',
    hint: '等宽字体，适合写代码笔记',
  },
]

export interface ProseStyle {
  font: string
  size: number
  leading: number
  /** 正文栏宽度（px），写进 --write-width */
  width: number
  /**
   * 首行缩进几个字（0 / 2）—— 中文排版的本命。
   * 0 就是现在这样（段首顶格，靠段间距分段），2 是纸书那种缩进两格。
   */
  indent: number
  /** 段间距，单位 em（跟着字号走，换字号不用重调） */
  gap: number
  /** 两端对齐。中文正文用它右边才会齐；英文长单词多的话左对齐更耐看 */
  justify: boolean
  /** 字间距，单位 em。中文排得密时加一点点会松快很多 */
  tracking: number
}

export const PROSE_DEFAULT: ProseStyle = {
  font: 'system',
  size: 16.5,
  leading: 1.85,
  width: 720,
  // 默认还是「段首顶格 + 一点段间距」，这是屏幕阅读的常态；
  // 想要纸书那种缩进两格，右栏里拨一下就有。
  indent: 0,
  gap: 0.55,
  justify: false,
  tracking: 0,
}
export const PROSE_RANGE = {
  minSize: 14,
  maxSize: 24,
  minLeading: 1.5,
  maxLeading: 2.6,
  // 窄到接近手机的阅读宽度，宽到铺满大屏；步进 20px 好对齐
  minWidth: 480,
  maxWidth: 1200,
  stepWidth: 20,
  minGap: 0,
  maxGap: 1.6,
  /** 首行缩进的候选值（单位「字」）—— 中文就 0 或 2，别的都不像话 */
  indents: [0, 1, 2],
  minTracking: 0,
  maxTracking: 0.06,
}

const KEY_FONT = 'quill-set:proseFont'
const KEY_SIZE = 'quill-set:proseSize'
const KEY_LEADING = 'quill-set:proseLeading'
const KEY_WIDTH = 'quill-set:proseWidth'
const KEY_INDENT = 'quill-set:proseIndent'
const KEY_GAP = 'quill-set:proseGap'
const KEY_JUSTIFY = 'quill-set:proseJustify'
const KEY_TRACKING = 'quill-set:proseTracking'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 写不进去就算了，不至于让界面崩 */
  }
}

export function readProse(): ProseStyle {
  return {
    font: read(KEY_FONT, PROSE_DEFAULT.font),
    size: read(KEY_SIZE, PROSE_DEFAULT.size),
    leading: read(KEY_LEADING, PROSE_DEFAULT.leading),
    width: clampWidth(read(KEY_WIDTH, PROSE_DEFAULT.width)),
    // 后加的四个键：老用户 localStorage 里没有，read 会走 fallback，不会崩
    indent: clampIndent(read(KEY_INDENT, PROSE_DEFAULT.indent)),
    gap: clampGap(read(KEY_GAP, PROSE_DEFAULT.gap)),
    justify: read(KEY_JUSTIFY, PROSE_DEFAULT.justify),
    tracking: clampTracking(read(KEY_TRACKING, PROSE_DEFAULT.tracking)),
  }
}

export function saveProse(next: ProseStyle): void {
  write(KEY_FONT, next.font)
  write(KEY_SIZE, next.size)
  write(KEY_LEADING, next.leading)
  write(KEY_WIDTH, next.width)
  write(KEY_INDENT, next.indent)
  write(KEY_GAP, next.gap)
  write(KEY_JUSTIFY, next.justify)
  write(KEY_TRACKING, next.tracking)
}

/** 夹到合法区间：手改过 localStorage、或从旧版本升上来，都不至于把版面撑坏 */
export function clampWidth(px: number): number {
  const n = Number(px)
  if (!Number.isFinite(n)) return PROSE_DEFAULT.width
  return Math.min(PROSE_RANGE.maxWidth, Math.max(PROSE_RANGE.minWidth, Math.round(n)))
}

/** 首行缩进只认候选值（0 / 1 / 2 字），别的值一律退回默认 */
export function clampIndent(v: number): number {
  const n = Number(v)
  return PROSE_RANGE.indents.includes(n) ? n : PROSE_DEFAULT.indent
}

export function clampGap(v: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return PROSE_DEFAULT.gap
  return Math.min(PROSE_RANGE.maxGap, Math.max(PROSE_RANGE.minGap, n))
}

export function clampTracking(v: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return PROSE_DEFAULT.tracking
  return Math.min(PROSE_RANGE.maxTracking, Math.max(PROSE_RANGE.minTracking, n))
}

/** 已经插过 <link> 的字体，别重复插 */
const cdnLoaded = new Set<string>()

/** 需要联网的字体：插一张 stylesheet 就行，浏览器只下用到的那几个分片 */
export function ensureFont(id: string): void {
  const option = FONTS.find((f) => f.id === id)
  if (!option?.cdn || cdnLoaded.has(option.id)) return
  cdnLoaded.add(option.id)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = option.cdn
  link.dataset.quillFont = option.id
  document.head.appendChild(link)
}

/** 系统里到底有没有这个字体（有就不用联网拉） */
export function fontInstalled(option: FontOption): boolean {
  if (!option.probe) return true
  try {
    return document.fonts.check(`16px ${option.probe}`)
  } catch {
    return false
  }
}

export function fontOption(id: string): FontOption {
  return FONTS.find((f) => f.id === id) ?? FONTS[0]
}

/** 把外观写进 CSS 变量；不传参数就用存下来的设置 */
export function applyProse(next?: ProseStyle): ProseStyle {
  const style = next ?? readProse()
  const option = fontOption(style.font)
  ensureFont(option.id)
  const root = document.documentElement.style
  root.setProperty('--font-prose', option.stack)
  root.setProperty('--prose-size', `${style.size}px`)
  root.setProperty('--prose-leading', String(style.leading))
  // 正文栏宽度也挂在这里：三种窗口共用一份前端产物，一处设置三处生效
  root.setProperty('--write-width', `${clampWidth(style.width)}px`)
  /*
   * 中文排版那几项。
   * 缩进和字间距都用 em —— 跟着字号走，主人调大字号的时侯不用重设一遍。
   * 段间距同理：写成 em 而不是 px，字号变了间距跟着长，不会突然显得挤。
   */
  root.setProperty('--prose-indent', `${clampIndent(style.indent)}em`)
  root.setProperty('--prose-gap', `${clampGap(style.gap)}em`)
  root.setProperty('--prose-tracking', `${clampTracking(style.tracking)}em`)
  root.setProperty('--prose-align', style.justify ? 'justify' : 'start')
  return style
}

/** 启动时调一次：主窗口和两个小窗口都在 main.tsx 里喊它 */
export function applyAppearance(): void {
  applyProse()
}
