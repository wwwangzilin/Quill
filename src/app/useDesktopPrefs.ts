import { useCallback, useEffect, useState } from 'react'
import { toast } from '../ui/toast'
import {
  DEFAULT_PREFS,
  autostartEnabled,
  isDesktop,
  loadDesktopPrefs,
  saveDesktopPrefs,
  setAutostart,
  type DesktopPrefs,
} from '../core/desktop'

/**
 * 桌面行为偏好（托盘 / 自启 / 自动同步）。
 * 偏好存在 Rust 侧，因为托盘事件发生在前端之外。
 */
export function useDesktopPrefs() {
  /** 桌面行为偏好（托盘 / 自启 / 自动同步）—— 存在 Rust 侧，因为托盘事件发生在前端之外 */
  const [desk, setDesk] = useState<DesktopPrefs>(DEFAULT_PREFS)
  /** 开机自启是系统里的事实，不是我们的设置，所以单独读一次 */
  const [autostart, setAutostartOn] = useState(false)

  /* 桌面版：托盘行为偏好与开机自启（浏览器模式整段跳过） */
  useEffect(() => {
    if (!isDesktop()) return
    void (async () => {
      setDesk(await loadDesktopPrefs())
      setAutostartOn(await autostartEnabled())
    })()
  }, [])

  const applyDesk = useCallback((next: DesktopPrefs) => {
    setDesk(next)
    void saveDesktopPrefs(next).catch((err) => toast.error('设置保存失败', String(err)))
  }, [])

  const applyAutostart = useCallback((next: boolean) => {
    setAutostartOn(next)
    void setAutostart(next)
      .then(() => toast.info(next ? '已开启开机自启' : '已关闭开机自启'))
      .catch((err) => {
        setAutostartOn(!next)
        toast.error('开机自启设置失败', String(err).slice(0, 120))
      })
  }, [])

  return { desk, autostart, applyDesk, applyAutostart }
}
