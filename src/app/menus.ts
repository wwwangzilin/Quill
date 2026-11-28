import type { Dispatch, SetStateAction } from 'react'
import type { MenuItem } from '../ui/MoreMenu'
import type { PaletteCommand } from '../ui/CommandPalette'
import { THEMES, nextTheme, themeInfo, type Theme } from '../core/theme'
import { openQuickNote } from '../core/windows'
import { storage } from '../core/storage'
import { backupNowAction, syncWebdavNow } from '../core/quickActions'
import { isDesktop } from '../core/desktop'
import { readCfg } from '../core/webdavSync'
import type { ViewMode } from '../core/types'

/** 菜单与命令面板需要的一切：状态读数 + 动作回调，都由 App 传入 */
export interface MenuCtx {
  hasDoc: boolean
  vaultMode: boolean
  view: ViewMode
  reading: boolean
  zen: boolean
  commentCount: number
  commentsOpen: boolean
  historyOpen: boolean
  focusMode: boolean
  typewriter: boolean
  theme: Theme

  createNew: (templateId?: string) => Promise<void>
  dailyNote: () => Promise<void>
  switchView: (v: ViewMode) => void
  pinToDesktop: () => Promise<void>
  exportMd: () => void
  exportHtml: () => void
  exportPdf: () => void
  exportJson: () => void
  importFolder: () => void
  importFiles: () => void
  copyRichText: () => Promise<void>
  toggleReading: () => void
  toggleZen: () => void
  /** 手动进长文本模式（自动判定之外的兜底入口） */
  enterLongform: () => void
  toggleFocus: () => void
  toggleTypewriter: () => void
  cycleTheme: () => void

  setReaderOpen: Dispatch<SetStateAction<boolean>>
  setCommentsOpen: Dispatch<SetStateAction<boolean>>
  setHistoryOpen: Dispatch<SetStateAction<boolean>>
  setLibraryOpen: Dispatch<SetStateAction<boolean>>
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  setChatOpen: Dispatch<SetStateAction<boolean>>
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>
  setStatsOpen: Dispatch<SetStateAction<boolean>>
  setSidebarOpen: Dispatch<SetStateAction<boolean>>
  setTrashOpen: Dispatch<SetStateAction<boolean>>
  setGlobalReviewOpen: Dispatch<SetStateAction<boolean>>
  setAnnotOpen: Dispatch<SetStateAction<boolean>>
}

/** 标题栏「⋯ 更多」菜单 */
export function buildMoreItems(c: MenuCtx): MenuItem[] {
  const {
    hasDoc,
    vaultMode,
    view,
    reading,
    zen,
    commentCount,
    commentsOpen,
    historyOpen,
    focusMode,
    typewriter,
    theme,
    exportMd,
    exportHtml,
    exportPdf,
    exportJson,
    importFolder,
    importFiles,
    copyRichText,
    toggleReading,
    toggleZen,
    toggleFocus,
    toggleTypewriter,
    cycleTheme,
    enterLongform,
    setReaderOpen,
    setCommentsOpen,
    setHistoryOpen,
    setLibraryOpen,
    setSettingsOpen,
    setChatOpen,
    setShortcutsOpen,
    setStatsOpen,
  } = c

  return [
    { key: 'md', icon: '⇩', label: '导出 Markdown', hint: '.md', disabled: !hasDoc, onSelect: exportMd },
    { key: 'html', icon: '⇩', label: '导出 HTML', hint: '单文件', disabled: !hasDoc, onSelect: exportHtml },
    {
      key: 'pdf',
      icon: '⎙',
      label: '导出 PDF',
      hint: '走系统打印',
      disabled: !hasDoc,
      onSelect: exportPdf,
    },
    { key: 'json', icon: '⇩', label: '导出 JSON', hint: '.json', disabled: !hasDoc, onSelect: exportJson },
    {
      key: 'import',
      icon: '⇧',
      label: '导入文件夹',
      hint: 'Markdown',
      disabled: !vaultMode,
      onSelect: () => void importFolder(),
    },
    {
      key: 'import-files',
      icon: '⇧',
      label: '导入文本 / 小说',
      hint: '.txt / .md / .epub',
      disabled: !vaultMode,
      onSelect: () => void importFiles(),
    },
    {
      key: 'longform',
      icon: '❏',
      label: '长文本模式',
      hint: '按章加载 · 可编辑',
      disabled: !hasDoc,
      onSelect: enterLongform,
    },
    {
      key: 'reader',
      icon: '▤',
      label: '小说阅读',
      hint: '分栏',
      disabled: !hasDoc,
      onSelect: () => setReaderOpen(true),
    },
    {
      key: 'reading',
      icon: '▤',
      label: '阅读模式',
      hint: 'F9',
      on: reading,
      disabled: view !== 'write',
      onSelect: toggleReading,
    },
    {
      key: 'zen',
      icon: '⛶',
      label: '禅模式',
      hint: 'F11',
      on: zen,
      disabled: view !== 'write',
      onSelect: toggleZen,
    },
    {
      key: 'richcopy',
      icon: '⧉',
      label: '复制为富文本',
      hint: '含格式',
      disabled: !hasDoc,
      onSelect: () => void copyRichText(),
    },
    {
      key: 'comments',
      icon: '❝',
      label: '批注',
      hint: commentCount ? `${commentCount} 条` : '选中文字后加',
      on: commentsOpen,
      disabled: !hasDoc,
      onSelect: () => setCommentsOpen((v) => !v),
    },
    {
      key: 'history',
      icon: '⏱',
      label: '版本历史',
      hint: vaultMode ? 'git' : '仅桌面版',
      on: historyOpen,
      disabled: !vaultMode || !hasDoc,
      onSelect: () => setHistoryOpen((v) => !v),
    },
    {
      key: 'focus',
      icon: '◉',
      label: '专注模式',
      on: focusMode,
      disabled: view !== 'write',
      onSelect: toggleFocus,
    },
    {
      key: 'typewriter',
      icon: '⇅',
      label: '打字机模式',
      on: typewriter,
      disabled: view !== 'write',
      onSelect: toggleTypewriter,
    },
    {
      key: 'theme',
      icon: themeInfo(theme).icon,
      label: '换个主题',
      hint: `${themeInfo(theme).label} · 共 ${THEMES.length} 套`,
      divider: true,
      onSelect: cycleTheme,
    },
    {
      key: 'library',
      icon: '▤',
      label: '文档库',
      hint: '浏览与筛选全部文档',
      onSelect: () => setLibraryOpen(true),
    },
    {
      key: 'stats',
      icon: '▥',
      label: '阅读统计',
      hint: '时长 · 日历 · 节律',
      onSelect: () => setStatsOpen(true),
    },
    {
      key: 'settings',
      icon: '⚙',
      label: '设置',
      hint: '外观 / 备份 / 更新',
      onSelect: () => setSettingsOpen(true),
    },
    {
      key: 'chat',
      icon: '✦',
      label: '问这篇文档',
      hint: 'Ctrl+Shift+A',
      disabled: !hasDoc,
      onSelect: () => setChatOpen(true),
    },
    {
      key: 'shortcuts',
      icon: '⌘',
      label: '快捷键一览',
      hint: 'Ctrl+/',
      onSelect: () => setShortcutsOpen(true),
    },
  ]
}

/** 命令面板（Ctrl+P）的命令清单 */
export function buildPaletteCommands(c: MenuCtx): PaletteCommand[] {
  const {
    commentCount,
    theme,
    createNew,
    dailyNote,
    switchView,
    pinToDesktop,
    exportMd,
    exportHtml,
    exportPdf,
    exportJson,
    importFolder,
    importFiles,
    copyRichText,
    toggleReading,
    toggleZen,
    toggleFocus,
    toggleTypewriter,
    cycleTheme,
    enterLongform,
    setReaderOpen,
    setCommentsOpen,
    setLibraryOpen,
    setSettingsOpen,
    setChatOpen,
    setShortcutsOpen,
    setStatsOpen,
    setSidebarOpen,
    setTrashOpen,
    setGlobalReviewOpen,
    setAnnotOpen,
  } = c
  const desktop = isDesktop()
  const davReady = desktop && Boolean(readCfg().url.trim())

  return [
    { id: 'new', title: '新建文档', hint: 'Ctrl+N', icon: '＋', run: () => void createNew() },
    { id: 'ask', title: 'AI 问答', hint: 'Ctrl+Shift+A', icon: '✦', run: () => setChatOpen(true) },
    { id: 'write', title: '切到写作视图', icon: '✎', run: () => switchView('write') },
    { id: 'map', title: '切到思维导图', icon: '◈', run: () => switchView('mindmap') },
    { id: 'export-md', title: '导出 Markdown', hint: '.md', icon: '⇩', run: exportMd },
    { id: 'export-html', title: '导出单文件 HTML', hint: '.html', icon: '⇩', run: exportHtml },
    { id: 'export-pdf', title: '导出 PDF', hint: '系统打印', icon: '⎙', run: exportPdf },
    { id: 'export-json', title: '导出 JSON', hint: '.json', icon: '⇩', run: exportJson },
    { id: 'import', title: '从文件夹导入 Markdown', icon: '⇧', run: () => void importFolder() },
    {
      id: 'import-files',
      title: '导入文本文件',
      hint: '.txt 自动转 Markdown',
      icon: '⇧',
      run: () => void importFiles(),
    },
    { id: 'daily', title: '今天的日记', hint: 'Ctrl+D', icon: '☀', run: () => void dailyNote() },
    { id: 'reading', title: '阅读模式', hint: 'F9', icon: '▤', run: toggleReading },
    { id: 'zen', title: '禅模式', hint: 'F11', icon: '⛶', run: toggleZen },
    {
      id: 'longform',
      title: '长文本模式',
      hint: '按章加载 · 可编辑',
      icon: '❏',
      run: enterLongform,
    },
    {
      id: 'reader',
      title: '小说阅读',
      hint: '分栏 + 章节目录',
      icon: '▤',
      run: () => setReaderOpen(true),
    },
    {
      id: 'comments',
      title: '批注',
      hint: commentCount ? `${commentCount} 条` : '选中文字后加',
      icon: '❝',
      run: () => setCommentsOpen(true),
    },
    { id: 'richcopy', title: '复制为富文本', icon: '⧉', run: () => void copyRichText() },
    {
      id: 'theme',
      title: '换个主题',
      hint: `${themeInfo(theme).label} · 下一个：${themeInfo(nextTheme(theme)).label}`,
      icon: themeInfo(theme).icon,
      run: cycleTheme,
    },
    { id: 'sidebar', title: '收起 / 展开侧栏', hint: 'Ctrl+\\', icon: '▤', run: () => setSidebarOpen((v) => !v) },
    { id: 'focus', title: '专注模式', icon: '◉', run: toggleFocus },
    { id: 'typewriter', title: '打字机模式', icon: '⇅', run: toggleTypewriter },
    { id: 'quick', title: '快捷便签', hint: 'Ctrl+Space', icon: '✎', run: () => void openQuickNote() },
    {
      id: 'sticky',
      title: '钉到桌面',
      icon: '📌',
      run: () => void pinToDesktop(),
    },
    { id: 'trash', title: '打开回收站', icon: '🗑', run: () => setTrashOpen(true) },
    { id: 'library', title: '文档库', icon: '▤', run: () => setLibraryOpen(true) },
    { id: 'settings', title: '设置', icon: '⚙', run: () => setSettingsOpen(true) },
    {
      id: 'annot',
      title: '批注与书签（跨书检索 / 导出）',
      hint: '搜所有书的批注 · 导出 Markdown',
      icon: '❝',
      run: () => setAnnotOpen(true),
    },
    {
      id: 'review',
      title: '批注复习',
      hint: '所有书里到期的批注 · 间隔重复',
      icon: '❝',
      run: () => setGlobalReviewOpen(true),
    },
    ...(davReady
      ? [{ id: 'webdav-sync', title: 'WebDAV 立即同步', hint: '文档 · 进度 · 书签 · 图片', icon: '⇅', run: () => void syncWebdavNow() }]
      : []),
    ...(desktop ? [{ id: 'backup-now', title: '立即备份文档仓库', hint: '打成一个 zip', icon: '⇩', run: () => void backupNowAction() }] : []),
    { id: 'stats', title: '阅读统计', hint: '时长 · 日历 · 节律', icon: '▥', run: () => setStatsOpen(true) },
    { id: 'shortcuts', title: '快捷键一览', hint: 'Ctrl+/', icon: '⌘', run: () => setShortcutsOpen(true) },
    { id: 'reveal', title: '在资源管理器里打开文档仓库', icon: '🗀', run: () => void storage.reveal() },
  ]
}
