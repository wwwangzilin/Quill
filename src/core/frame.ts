/**
 * 无边框窗口的窗口控制。
 *
 * 主窗口去掉了系统标题栏（tauri.conf.json → `decorations: false`），
 * 于是最小化 / 最大化 / 关闭 / 拖动这四件事全落到自绘顶栏头上。
 * 它们是窗口唯一的出口 —— 任何一件不通，窗口就关不掉了，
 * 所以这里每个动作都要有结果，失败宁可留一行 warn，也不静默当没发生。
 */
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from './windows'

/** 现在是不是最大化状态（还原按钮靠它换图标） */
export async function isWindowMaximized(): Promise<boolean> {
  if (!isTauri()) return false
  try {
    return await getCurrentWindow().isMaximized()
  } catch {
    return false
  }
}

export async function minimizeWindow(): Promise<void> {
  if (!isTauri()) return
  try {
    await getCurrentWindow().minimize()
  } catch (e) {
    console.warn('最小化窗口失败', e)
  }
}

export async function toggleMaximizeWindow(): Promise<void> {
  if (!isTauri()) return
  try {
    await getCurrentWindow().toggleMaximize()
  } catch (e) {
    console.warn('切换最大化失败', e)
  }
}

export async function closeWindow(): Promise<void> {
  if (!isTauri()) return
  try {
    await getCurrentWindow().close()
  } catch (e) {
    console.warn('关闭窗口失败', e)
  }
}

/**
 * 盯着最大化状态。
 *
 * WebView 里没有「窗口被最大化」这个事件，Tauri 只给 resize，
 * 所以只能 resize 之后反查一次。加 150ms 防抖 ——
 * 拖窗口边框时 resize 是每帧一次的，每次都过一次 IPC 太浪费。
 * 返回的就是取消订阅，useEffect 可以拿它直接当 cleanup。
 */
export function watchMaximize(onChange: (maximized: boolean) => void): () => void {
  if (!isTauri()) return () => {}
  const win = getCurrentWindow()
  let alive = true
  let timer = 0

  const read = () => {
    void win
      .isMaximized()
      .then((m) => {
        if (alive) onChange(m)
      })
      .catch(() => {})
  }

  read()
  const pending = win
    .onResized(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(read, 150)
    })
    .catch(() => null)

  return () => {
    alive = false
    window.clearTimeout(timer)
    void pending.then((un) => un?.())
  }
}
