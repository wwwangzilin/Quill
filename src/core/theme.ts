/**
 * 主题的唯一来源。
 *
 * 主题是靠 `<html data-theme="...">` 生效的，一份前端产物同时服务三种窗口：
 * 主窗口、快捷便签、桌面磁贴。以前只有主窗口的 App 组件会写这个属性，
 * 于是便签和磁贴没人管，只能跟着系统偏好走 —— 主窗口手动选了暗色，
 * 它们却还是浅色，看起来就像两套软件。
 *
 * 所以：读、写、初始化都收在这里，谁开窗谁先调 initTheme()。
 *
 * 一套主题 = style.css 里的一段变量覆盖（颜色 + 圆角 + 阴影）。
 * **字体不归主题管** —— 那是「设置 → 外观」里的排版项，用户选了就得算数。
 */

import { applyAccent } from './accent'

export type Theme = 'glass' | 'glass-night'

export interface ThemeInfo {
  id: Theme
  label: string
  hint: string
  /** 深色底。导图导出、代码高亮之类需要自己配色的地方靠它判断 */
  dark: boolean
  /** 选择器上的小色块，免得只能靠名字猜 */
  swatch: [string, string]
  /** 标题栏与菜单里用的图标 */
  icon: string
}

export const THEMES: ThemeInfo[] = [
  {
    id: 'glass',
    label: '玻璃奶白',
    hint: '冷调奶白底，栏位浮成玻璃胶囊，单一深青点缀',
    dark: false,
    swatch: ['#f3f6fa', '#1f6f78'],
    icon: '◇',
  },
  {
    id: 'glass-night',
    label: '玻璃夜墨',
    hint: '深蓝墨色底，同样的玻璃质感，夜里写不刺眼',
    dark: true,
    swatch: ['#0d1218', '#5fb3bd'],
    icon: '◆',
  },
]

/** 按当前主题循环到下一个 —— 标题栏那个按钮与命令面板共用 */
export function nextTheme(current: Theme): Theme {
  const i = THEMES.findIndex((t) => t.id === current)
  return THEMES[(i + 1) % THEMES.length].id
}

const THEME_KEY = 'quill-theme'
const DEFAULT_THEME: Theme = 'glass'

/**
 * 旧版本有 6 套老主题，现在收成了两套玻璃主题。
 * 存档里还是旧 id 的，按明暗各自落到对应的新主题上，别让人一升级就掉回默认。
 */
const LEGACY_THEME: Record<string, Theme> = {
  dark: 'glass-night',
  night: 'glass-night',
  light: 'glass',
  ink: 'glass',
  paper: 'glass',
  sakura: 'glass',
}

/** 这个 id 认不认识（存坏了、存了旧版本的值都要能兜住） */
export function isTheme(v: unknown): v is Theme {
  return typeof v === 'string' && THEMES.some((t) => t.id === v)
}

export function themeInfo(id: Theme): ThemeInfo {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

/** 当前这套是不是深色底 —— 给它一个 id 就按它算，不给就按当前主题算 */
export function isDarkTheme(id?: Theme): boolean {
  return themeInfo(id ?? readTheme()).dark
}

/** 取当前主题。取不到（首次启动、隐私模式写不进）就默认玻璃奶白；旧 id 按 LEGACY_THEME 迁移。 */
export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (isTheme(v)) return v
    return (v && LEGACY_THEME[v]) || DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

/** 应用并记住主题 */
let fadeTimer: number | undefined

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  // 真换了主题（不是启动时首次贴上）才做颜色渐变：先挂 .theme-fading 再改，样式见 styles/35-motion-polish.css
  if (root.dataset.theme && root.dataset.theme !== theme) {
    root.classList.add('theme-fading')
    window.clearTimeout(fadeTimer)
    fadeTimer = window.setTimeout(() => root.classList.remove('theme-fading'), 520)
  }
  root.dataset.theme = theme
  // 自选的强调色要按新主题的明暗重新推一遍（深底要偏亮，浅底要偏深）
  applyAccent(themeInfo(theme).dark)
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* 写不进去也不影响这次显示 */
  }
}

/**
 * 窗口启动时调用：把已保存的主题贴到 <html> 上。
 * 三种窗口都必须在渲染前调它，否则界面会先按系统偏好闪一下。
 */
export function initTheme(): Theme {
  const theme = readTheme()
  document.documentElement.dataset.theme = theme
  applyAccent(themeInfo(theme).dark)
  return theme
}
