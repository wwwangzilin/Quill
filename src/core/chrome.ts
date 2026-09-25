/**
 * 打字时自动收起顶栏与底栏。
 *
 * 和禅模式（F11 全屏 + 手动开关）不一样：这里是**自动的** ——
 * 只要你在正文里敲字，标题栏和状态栏就滑出去，只留写作区；
 * 鼠标一动它们立刻回来。想法是「写的时候别让界面晃在眼前，
 * 但随时想看状态、想拖窗口都能马上找回来」。
 *
 * 默认开启。不喜欢界面乱动的话，在「设置 → 写作」里可以关掉。
 */

const KEY = 'quill-auto-hide-bars'

/** 是否开启。默认开 —— 这是主人点名要的行为。 */
export function readAutoHide(): boolean {
  try {
    const v = localStorage.getItem(KEY)
    return v === null ? true : v === '1'
  } catch {
    return true
  }
}

export function applyAutoHide(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* 记不住偏好不影响这次 */
  }
}
