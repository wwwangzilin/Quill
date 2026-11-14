import { useEffect, type Dispatch, type SetStateAction } from 'react'

/**
 * 全局快捷键：Ctrl+S / Ctrl+Shift+A / Ctrl+/ / Ctrl+N / Ctrl+D / Ctrl+\ / F9，
 * 以及设置界面里按 Esc 返回。F11 归禅模式自己管。
 */
export function useAppShortcuts(opts: {
  flush: () => Promise<void>
  createNew: (templateId?: string) => Promise<void>
  dailyNote: () => Promise<void>
  toggleReading: () => void
  settingsOpen: boolean
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  setChatOpen: Dispatch<SetStateAction<boolean>>
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>
  setSidebarOpen: Dispatch<SetStateAction<boolean>>
}) {
  const {
    flush,
    createNew,
    dailyNote,
    toggleReading,
    settingsOpen,
    setSettingsOpen,
    setChatOpen,
    setShortcutsOpen,
    setSidebarOpen,
  } = opts

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void flush()
      }
      // Ctrl+Shift+A：问这篇文档
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setChatOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flush])

  // 设置界面按 Esc 返回
  useEffect(() => {
    if (!settingsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 正在输入框里按 Esc 就不抢，交给输入框自己处理
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      setSettingsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen])

  // 全局快捷键（放在 createNew 之后，避免 TDZ）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === '/') {
        e.preventDefault()
        setShortcutsOpen((v) => !v)
        return
      }
      if (key === 'n') {
        e.preventDefault()
        void createNew('blank')
        return
      }
      if (key === 'd') {
        e.preventDefault()
        void dailyNote()
        return
      }
      if (key === '\\') {
        e.preventDefault()
        setSidebarOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [createNew, dailyNote])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F9') return
      e.preventDefault()
      toggleReading()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleReading])
}
