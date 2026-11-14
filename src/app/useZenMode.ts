import { useCallback, useEffect, useRef, useState } from 'react'
import { isDesktop } from '../core/desktop'

/**
 * 禅模式（F11）：窗口真全屏 + 藏掉整个界面，只剩正文。
 */
export function useZenMode() {
  /** 禅模式：窗口真全屏 + 藏掉整个界面，只剩正文（F11） */
  const [zen, setZen] = useState(false)
  /** 进全屏之前窗口是不是最大化的 —— 退出来要照原样补回去 */
  const wasMaximizedRef = useRef(false)

  /* ---------------- 禅模式（F11） ---------------- */

  const zenRef = useRef(false)
  useEffect(() => {
    zenRef.current = zen
  }, [zen])

  /**
   * 禅模式：窗口切真全屏 + 藏掉标题栏 / 侧栏 / 状态栏，只剩正文。
   * 全屏失败（被系统拒、浏览器没权限）也不影响 —— 界面该隐的还是隐。
   */
  const toggleZen = useCallback(() => {
    const next = !zenRef.current
    setZen(next)
    void (async () => {
      try {
        if (isDesktop()) {
          const { getCurrentWindow } = await import('@tauri-apps/api/window')
          const win = getCurrentWindow()
          if (next) {
            // 进全屏之前，先把窗口从最大化还原掉。
            //
            // 「最大化」和「全屏」这两个状态在 Windows 上会打架：最大化时窗口矩形
            // 已经是整屏了，这时再调 setFullscreen(true)，窗口一个像素都不动，
            // 而 WebView 的视口还停在**工作区**高度 —— 屏幕下方就留出一条任务栏
            // 那么高的黑条（露出来的是窗口背景色）。先还原成普通窗口，全屏才真铺满。
            wasMaximizedRef.current = await win.isMaximized()
            if (wasMaximizedRef.current) {
              await win.toggleMaximize()
              // 等 Windows 把「还原」这一步落定，否则紧接着的全屏会读到旧状态
              await new Promise((r) => window.setTimeout(r, 140))
            }
            await win.setFullscreen(true)
          } else {
            await win.setFullscreen(false)
            if (wasMaximizedRef.current) {
              wasMaximizedRef.current = false
              await new Promise((r) => window.setTimeout(r, 140))
              await win.toggleMaximize()
            }
          }
        } else if (next) {
          await document.documentElement.requestFullscreen()
        } else if (document.fullscreenElement) {
          await document.exitFullscreen()
        }
      } catch {
        /* 全屏没切成也照常进出禅模式 */
      }
    })()
  }, [])

  // 走捕获阶段：抢在 WebView 自己处理 F11 全屏之前
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F11') return
      e.preventDefault()
      e.stopPropagation()
      toggleZen()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [toggleZen])

  // 用别的方式退出全屏（Win+↓、Esc、系统快捷键）时，跟着退出禅模式
  useEffect(() => {
    if (!zen || !isDesktop()) return
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window')
          const win = getCurrentWindow()
          if (!(await win.isFullscreen())) {
            setZen(false)
            // 全屏是被别的方式退掉的，这里同样得把最大化补回去 ——
            // 不补的话窗口会停在被还原的那个大小上
            if (wasMaximizedRef.current) {
              wasMaximizedRef.current = false
              await win.toggleMaximize()
            }
          }
        } catch {
          /* 取不到就当没变 */
        }
      })()
    }, 1500)
    return () => window.clearInterval(timer)
  }, [zen])

  return { zen, toggleZen }
}
