import { useEffect } from 'react'
import { toast } from '../ui/toast'
import { checkUpdate } from '../core/update'
import { isDesktop } from '../core/desktop'

/** 启动后静默检查一次更新。 */
export function useUpdateCheck() {
  /**
   * 启动后静默查一次有没有新版：有才提示，查不到（没网、代理拦了）就当无事发生。
   * 延迟 8 秒是别跟界面初始化抢那点启动时间。
   */
  useEffect(() => {
    if (!isDesktop()) return
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const info = await checkUpdate()
          if (info) toast.info(`有新版本 ${info.version}`, '可在「设置 → 关于」中更新')
        } catch {
          /* 静默：网络不通不该打扰写作 */
        }
      })()
    }, 8000)
    return () => window.clearTimeout(timer)
  }, [])
}
