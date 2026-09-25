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

export type Theme = 'dark' | 'light' | 'ink' | 'paper' | 'night' | 'sakura'

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
    id: 'dark',
    label: '暗色',
    hint: '暖木底配琥珀金，夜里写最舒服',
    dark: true,
    swatch: ['#0f0e0d', '#cba56b'],
    icon: '☾',
  },
  {
    id: 'light',
    label: '亮色',
    hint: '干净的米白，白天用着清爽',
    dark: false,
    swatch: ['#faf7f2', '#9c7420'],
    icon: '☀',
  },
  {
    id: 'ink',
    label: '墨水',
    hint: '宣纸与朱红，圆角收到最小，像在读一册书',
    dark: false,
    swatch: ['#f7f6f2', '#a33a2a'],
    icon: '✒',
  },
  {
    id: 'paper',
    label: '羊皮纸',
    hint: '暖黄纸感，长时间读不刺眼',
    dark: false,
    swatch: ['#f4ecd8', '#96662a'],
    icon: '▤',
  },
  {
    id: 'night',
    label: '夜蓝',
    hint: '深蓝低对比，比纯黑柔和',
    dark: true,
    swatch: ['#0e1620', '#6ea8d8'],
    icon: '✦',
  },
  {
    id: 'sakura',
    label: '樱花',
    hint: '浅粉配紫，轻快一点',
    dark: false,
    swatch: ['#fdf6f8', '#c2547f'],
    icon: '❀',
  },
]

/** 按当前主题循环到下一个 —— 标题栏那个按钮与命令面板共用 */
export function nextTheme(current: Theme): Theme {
  const i = THEMES.findIndex((t) => t.id === current)
  return THEMES[(i + 1) % THEMES.length].id
}

const THEME_KEY = 'quill-theme'
const DEFAULT_THEME: Theme = 'dark'

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

/** 取当前主题。取不到（首次启动、隐私模式写不进）就默认暗色。 */
export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return isTheme(v) ? v : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

/** 应用并记住主题 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
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
  return theme
}
