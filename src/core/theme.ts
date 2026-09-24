/**
 * 主题的唯一来源。
 *
 * 主题是靠 `<html data-theme="...">` 生效的，而这份前端产物同时服务三种窗口：
 * 主窗口、快捷便签、桌面磁贴。以前只有主窗口的 App 组件会写这个属性，
 * 于是便签和磁贴没人管，只能跟着系统偏好走 —— 主窗口手动选了暗色，
 * 它们却还是浅色，看起来就像两套软件。
 *
 * 所以：读、写、初始化都收在这里，谁开窗谁先调 initTheme()。
 */

export type Theme = 'dark' | 'light'

const THEME_KEY = 'quill-theme'

/** 取当前主题。取不到（首次启动、隐私模式写不进）就默认暗色。 */
export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
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
