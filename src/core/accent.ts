/**
 * 强调色：用户自选的一个主色，盖在当前主题的 --accent-1 / --accent-soft / --grad 上。
 *
 * 和主题是两件事 —— 主题管底色、圆角、阴影，强调色只管「点缀」。
 * 选了强调色之后换主题，它还在；清掉（选「跟随主题」）才回到各主题自带的点缀色。
 *
 * 亮度会按当前主题是深是浅自动收敛：同一个青色放在奶白底上要偏深才读得清，
 * 放在深色底上要偏亮才不沉。用户挑的是「色相」，明暗交给这里。
 * 所以三个窗口（主窗口 / 便签 / 磁贴）都得在启动时调一次 —— 见 core/theme.ts 的 initTheme。
 */

const ACCENT_KEY = 'quill-accent'

export interface AccentPreset {
  id: string
  label: string
  hex: string
}

/** 预设：挑的是「放在浅底和深底上都好看」的几个色相 */
export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'teal', label: '深青', hex: '#1f6f78' },
  { id: 'dusk', label: '暮紫', hex: '#6b5aa6' },
  { id: 'cinnabar', label: '朱砂', hex: '#b04a3a' },
  { id: 'pine', label: '松针', hex: '#2f7d5b' },
  { id: 'amber', label: '琥珀', hex: '#a9791f' },
  { id: 'indigo', label: '靛蓝', hex: '#3d5a9e' },
]

const HEX_RE = /^#[0-9a-f]{6}$/i

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v)
}

/* ---------------- 颜色换算（只在这里用，几十行就够，不引依赖） ---------------- */

type RGB = [number, number, number]

function parseHex(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h * 60, s, l]
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function css([r, g, b]: RGB, alpha?: number): string {
  return alpha === undefined ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export interface DerivedAccent {
  base: string
  soft: string
  grad: string
}

/** 相对亮度（WCAG），用来保证强调色放在底上读得清 */
function luminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

// 各主题底色里最「不利」的两头：最浅的浅底、最深的深底。拿它们当尺子，其余主题只会更宽松
const LIGHT_BG_LUM = 0.94
const DARK_BG_LUM = 0.012
const MIN_CONTRAST = 4.5

/**
 * 由一个色相推出三个变量。
 * 只取用户挑的「色相」和（封过顶的）饱和度，明度由对比度说了算：
 * 浅底上一路压暗、深底上一路提亮，直到对底色达到 4.5:1。
 * 所以不管挑的是亮黄还是荧光绿，落到界面上都是读得清的颜色。
 */
export function deriveAccent(hex: string, dark: boolean): DerivedAccent {
  const [h, s0, l0] = rgbToHsl(parseHex(hex))
  const s = clamp(s0, 0.25, 0.72)
  const bg = dark ? DARK_BG_LUM : LIGHT_BG_LUM
  let l = dark ? clamp(l0, 0.58, 0.8) : clamp(l0, 0.2, 0.46)
  for (let i = 0; i < 60; i++) {
    if (contrast(luminance(hslToRgb(h, s, l)), bg) >= MIN_CONTRAST) break
    l += dark ? 0.01 : -0.01
  }
  l = clamp(l, 0.08, 0.9)
  return {
    base: css(hslToRgb(h, s, l)),
    soft: css(hslToRgb(h, s, l), dark ? 0.16 : 0.12),
    grad: `linear-gradient(135deg, ${css(hslToRgb(h, s, clamp(l + 0.07, 0, 0.9)))}, ${css(
      hslToRgb(h, s, clamp(l - 0.08, 0.05, 1)),
    )})`,
  }
}

/* ---------------- 读写与应用 ---------------- */

/** 取已保存的强调色；没选过、存坏了都当「跟随主题」 */
export function readAccent(): string | null {
  try {
    const v = localStorage.getItem(ACCENT_KEY)
    return isHexColor(v) ? v.toLowerCase() : null
  } catch {
    return null
  }
}

const VARS = ['--accent-1', '--accent-soft', '--grad'] as const

/**
 * 把已保存的强调色贴到 <html> 上（没有就清掉，露出主题自带的）。
 * 换主题要重调一次：明暗不同，推出来的颜色也不同。
 */
export function applyAccent(dark: boolean): void {
  const root = document.documentElement
  const hex = readAccent()
  if (!hex) {
    for (const v of VARS) root.style.removeProperty(v)
    delete root.dataset.accent
    return
  }
  const d = deriveAccent(hex, dark)
  root.style.setProperty('--accent-1', d.base)
  root.style.setProperty('--accent-soft', d.soft)
  root.style.setProperty('--grad', d.grad)
  // 样式里有十来处写死的琥珀色（发光、阴影），见 styles/25-accent.css，靠这个标记改成跟随
  root.dataset.accent = 'custom'
}

/** 选定（或传 null 清掉）并立刻生效 */
export function setAccent(hex: string | null, dark: boolean): void {
  try {
    if (hex && isHexColor(hex)) localStorage.setItem(ACCENT_KEY, hex.toLowerCase())
    else localStorage.removeItem(ACCENT_KEY)
  } catch {
    /* 写不进去也不影响这次显示 */
  }
  applyAccent(dark)
}
