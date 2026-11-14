/**
 * 动效策略的唯一来源。
 *
 * 默认**不跟随**系统的「减少动效」：界面里的过渡是设计的一部分，
 * 在关掉系统动画的机器上跟着一起关，整个应用会退化成一帧帧硬切 ——
 * 面板突然出现、列表直接跳位，看起来像是没做完。
 *
 * 想让系统设置生效，就打开「跟随系统的动画设置」：那时 <html> 上会挂
 * `.respect-motion`，style.css 里那两段 @media (prefers-reduced-motion) 才开始工作。
 *
 * 和主题同理，三种窗口（主窗口 / 快捷便签 / 桌面磁贴）都要在渲染前调 initMotion()，
 * 否则子窗口会各走各的。
 */

const MOTION_KEY = 'quill-respect-motion'
const CLASS = 'respect-motion'

/** 是否跟随系统的「减少动效」。默认否 —— 动画照常播。 */
export function readRespectMotion(): boolean {
  try {
    return localStorage.getItem(MOTION_KEY) === '1'
  } catch {
    return false
  }
}

/** 应用并记住这个选择 */
export function applyRespectMotion(on: boolean): void {
  document.documentElement.classList.toggle(CLASS, on)
  try {
    localStorage.setItem(MOTION_KEY, on ? '1' : '0')
  } catch {
    /* 写不进去也只是记不住偏好，不影响这一次 */
  }
}

/** 窗口启动时调用：把已保存的选择贴到 <html> 上 */
export function initMotion(): boolean {
  const on = readRespectMotion()
  document.documentElement.classList.toggle(CLASS, on)
  return on
}
