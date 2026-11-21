import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { SHORTCUTS, isTypingTarget, matches, type ShortcutId } from '../core/shortcuts'

/**
 * 全局快捷键：**一套清单，一处分发**。
 *
 * 键位与提示文案都在 `core/shortcuts.ts`；这里只负责把事件路由到具体动作，
 * 并对「输入法组词中 / 弹窗开着」这类场景做统一排除。
 * 命令面板、全库搜索、编辑器内的 Ctrl+F 由各自组件管（它们要在自己的焦点范围内
 * 处理方向键），但它们的提示文本同样从清单里取，避免「写着有、按了没」。
 */
export function useAppShortcuts(opts: {
  /** 返回值不在乎，只要动作是「保存」 */
  flush: () => Promise<unknown>
  createNew: (templateId?: string) => Promise<void>
  dailyNote: () => Promise<void>
  toggleReading: () => void
  closeTab: () => void
  nextTab: () => void
  prevTab: () => void
  selectTab: (index: number) => void
  /** 回到上一个用过的文档（MRU） */
  prevDoc: () => void
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
    closeTab,
    nextTab,
    prevTab,
    selectTab,
    prevDoc,
    settingsOpen,
    setSettingsOpen,
    setChatOpen,
    setShortcutsOpen,
    setSidebarOpen,
  } = opts

  useEffect(() => {
    const actions: Partial<Record<ShortcutId, () => void>> = {
      save: () => void flush(),
      closeTab: () => closeTab(),
      nextTab: () => nextTab(),
      prevTab: () => prevTab(),
      tab1: () => selectTab(0),
      tab2: () => selectTab(1),
      tab3: () => selectTab(2),
      tab4: () => selectTab(3),
      tab5: () => selectTab(4),
      tab6: () => selectTab(5),
      tab7: () => selectTab(6),
      tab8: () => selectTab(7),
      tab9: () => selectTab(8),
      newDoc: () => void createNew('blank'),
      daily: () => void dailyNote(),
      askAi: () => setChatOpen((v) => !v),
      shortcuts: () => setShortcutsOpen((v) => !v),
      sidebar: () => setSidebarOpen((v) => !v),
      prevDoc: () => prevDoc(),
      reading: () => toggleReading(),
    }

    const onKey = (e: KeyboardEvent) => {
      // 输入法组词中不抢：那一下的 key 是半成品，抢了会把中文吞掉
      if (e.isComposing) return
      // 设置页开着自己的 Esc；这里只处理带修饰键的组合
      for (const id of Object.keys(SHORTCUTS) as ShortcutId[]) {
        if (!matches(e, id)) continue
        const run = actions[id]
        if (!run) continue
        // 无修饰键的（F9/F11）在输入框里别抢
        if (!SHORTCUTS[id].ctrl && isTypingTarget(e.target)) continue
        e.preventDefault()
        run()
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    flush,
    createNew,
    dailyNote,
    toggleReading,
    closeTab,
    nextTab,
    prevTab,
    selectTab,
    prevDoc,
    setChatOpen,
    setShortcutsOpen,
    setSidebarOpen,
  ])

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
  }, [settingsOpen, setSettingsOpen])
}
