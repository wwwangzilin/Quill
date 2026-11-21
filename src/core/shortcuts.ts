/**
 * 快捷键的**唯一清单**。
 *
 * 以前快捷键散在三四个组件里，提示文案各自手写：改了键位忘了改提示、
 * 或者提示写着 Ctrl+W 其实没人监听 —— 用户按下去没反应，比没有提示更伤。
 * 现在新增一个快捷键只改这里；界面上的提示统一问 `hintOf()`。
 *
 * 平台差异只在**显示**上做：Windows/Linux 用 Ctrl+Shift+字母，
 * macOS 显示成 ⌘⇧字母（实际匹配时 meta 与 ctrl 等价）。
 */

export type ShortcutId =
  | 'save'
  | 'closeTab'
  | 'nextTab'
  | 'prevTab'
  | 'tab1'
  | 'tab2'
  | 'tab3'
  | 'tab4'
  | 'tab5'
  | 'tab6'
  | 'tab7'
  | 'tab8'
  | 'tab9'
  | 'palette'
  | 'newDoc'
  | 'daily'
  | 'find'
  | 'searchAll'
  | 'askAi'
  | 'shortcuts'
  | 'sidebar'
  | 'prevDoc'
  | 'reading'
  | 'zen'

interface Def {
  label: string
  /** 主键（小写；Tab/Enter 这种首字母大写） */
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

export const SHORTCUTS: Record<ShortcutId, Def> = {
  save: { label: '保存当前文档', key: 's', ctrl: true },
  closeTab: { label: '关闭当前标签页', key: 'w', ctrl: true },
  nextTab: { label: '下一个标签页', key: 'tab', ctrl: true },
  prevTab: { label: '上一个标签页', key: 'tab', ctrl: true, shift: true },
  tab1: { label: '切换到第 1 个标签页', key: '1', ctrl: true },
  tab2: { label: '切换到第 2 个标签页', key: '2', ctrl: true },
  tab3: { label: '切换到第 3 个标签页', key: '3', ctrl: true },
  tab4: { label: '切换到第 4 个标签页', key: '4', ctrl: true },
  tab5: { label: '切换到第 5 个标签页', key: '5', ctrl: true },
  tab6: { label: '切换到第 6 个标签页', key: '6', ctrl: true },
  tab7: { label: '切换到第 7 个标签页', key: '7', ctrl: true },
  tab8: { label: '切换到第 8 个标签页', key: '8', ctrl: true },
  tab9: { label: '切换到第 9 个标签页', key: '9', ctrl: true },
  palette: { label: '命令面板 / 全局搜索', key: 'p', ctrl: true },
  newDoc: { label: '新建文档', key: 'n', ctrl: true },
  daily: { label: '今天的日记', key: 'd', ctrl: true },
  find: { label: '在当前文档里查找', key: 'f', ctrl: true },
  searchAll: { label: '全库搜索', key: 'f', ctrl: true, shift: true },
  askAi: { label: '问这篇文档', key: 'a', ctrl: true, shift: true },
  shortcuts: { label: '快捷键一览', key: '/', ctrl: true },
  sidebar: { label: '收起 / 展开侧栏', key: '\\', ctrl: true },
  prevDoc: { label: '回到上一个用过的文档', key: 'p', ctrl: true, alt: true },
  reading: { label: '阅读模式', key: 'f9' },
  zen: { label: '禅模式', key: 'f11' },
}

export const isMac = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')

/** 组合键的展示文本：Windows 用 Ctrl+Shift+S，macOS 用 ⌘⇧S */
export function hintOf(id: ShortcutId): string {
  const d = SHORTCUTS[id]
  const mac = isMac()
  const parts: string[] = []
  if (d.ctrl) parts.push(mac ? '⌘' : 'Ctrl')
  if (d.shift) parts.push(mac ? '⇧' : 'Shift')
  if (d.alt) parts.push(mac ? '⌥' : 'Alt')
  const key = d.key.length === 1 ? d.key.toUpperCase() : d.key.toUpperCase()
  if (mac && parts.length) return parts.join('') + key
  return [...parts, key].join('+')
}

function normKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key.toLowerCase()
}

/**
 * 这个键盘事件是不是这条快捷键。
 *
 * 规则：macOS 上 meta 与 ctrl 等价（用户按 ⌘S 或 Ctrl+S 都算）；
 * shift / alt 必须**精确**匹配 —— 否则 Ctrl+Shift+F 会被 Ctrl+F 抢走。
 */
export function matches(e: KeyboardEvent, id: ShortcutId): boolean {
  const d = SHORTCUTS[id]
  const mod = e.ctrlKey || e.metaKey
  if (Boolean(d.ctrl) !== mod) return false
  if (Boolean(d.shift) !== e.shiftKey) return false
  if (Boolean(d.alt) !== e.altKey) return false
  return normKey(e.key) === d.key
}

/** 输入法组词中、或者焦点在输入框里时的兜底判断交给调用方 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}
