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
    name: '默认（系统界面字体）',
    stack: 'var(--font-ui)',
    probe: '',
    hint: '跟着系统走，最稳当',
  },
  {
    id: 'wenkai',
    name: '霞鹜文楷 LXGW WenKai',
    stack: '"LXGW WenKai Lite", "LXGW WenKai", "LXGW WenKai Screen", var(--font-ui)',
    probe: '"LXGW WenKai Lite"',
    cdn: WENKAI_CSS,
    hint: '楷体笔意，长文读着舒服。首次选用会按需取字形（只下用到的字）',
  },
  {
    id: 'inter',
    name: 'Inter（西文 + 数字）',
    stack: '"Inter Variable", "Inter var", "Inter", var(--font-ui)',
    probe: '"Inter Variable"',
    cdn: INTER_CSS,
    hint: '西文和数字更利落，中文自动回退',
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
    name: '宋体（衬线）',
    stack: '"Songti SC", SimSun, "Noto Serif SC", serif',
    probe: 'SimSun',
    hint: '端端正正的印刷味',
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
    name: '等宽（JetBrains Mono）',
    stack: 'var(--font-mono)',
    probe: '"JetBrains Mono"',
    hint: '写代码笔记用',
  },
]

export interface ProseStyle {
  font: string
  size: number
  leading: number
}

export const PROSE_DEFAULT: ProseStyle = { font: 'system', size: 16.5, leading: 1.85 }
export const PROSE_RANGE = { minSize: 14, maxSize: 24, minLeading: 1.5, maxLeading: 2.6 }

const KEY_FONT = 'quill-set:proseFont'
const KEY_SIZE = 'quill-set:proseSize'
const KEY_LEADING = 'quill-set:proseLeading'

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
  }
}

export function saveProse(next: ProseStyle): void {
  write(KEY_FONT, next.font)
  write(KEY_SIZE, next.size)
  write(KEY_LEADING, next.leading)
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
  return style
}

/** 启动时调一次：主窗口和两个小窗口都在 main.tsx 里喊它 */
export function applyAppearance(): void {
  applyProse()
}
