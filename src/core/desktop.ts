/**
 * 桌面版专属能力：托盘行为偏好 / 开机自启 / 批量导入。
 * 浏览器调试模式下全部是安全空操作 —— 调用方先看 isDesktop()。
 */
import { invoke } from '@tauri-apps/api/core'

export interface DesktopPrefs {
  /** 点 × 收进托盘（这样 Ctrl+Space 快速便签才一直可用） */
  closeToTray: boolean
  /** 定时把文档仓库推到远程 */
  autoSync: boolean
  /** 自动同步间隔（分钟） */
  syncMinutes: number
}

export const DEFAULT_PREFS: DesktopPrefs = {
  closeToTray: true,
  autoSync: false,
  syncMinutes: 30,
}

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function loadDesktopPrefs(): Promise<DesktopPrefs> {
  if (!isDesktop()) return DEFAULT_PREFS
  try {
    return await invoke<DesktopPrefs>('desktop_prefs')
  } catch {
    return DEFAULT_PREFS
  }
}

export async function saveDesktopPrefs(prefs: DesktopPrefs): Promise<void> {
  if (!isDesktop()) return
  await invoke('save_desktop_prefs', { prefs })
}

export async function autostartEnabled(): Promise<boolean> {
  if (!isDesktop()) return false
  try {
    return await invoke<boolean>('autostart_enabled')
  } catch {
    return false
  }
}

export async function setAutostart(on: boolean): Promise<void> {
  if (!isDesktop()) return
  await invoke('set_autostart', { enabled: on })
}

/** 批量导入 Markdown 原文，返回真正落盘的篇数 */
export async function importMarkdown(
  items: { title: string; content: string }[],
): Promise<number> {
  if (!isDesktop()) throw new Error('导入只在桌面版可用')
  return await invoke<number>('import_docs', { items })
}

export interface ImportedDoc {
  title: string
  content: string
}

/**
 * 从一个 `<input type="file" webkitdirectory>` 选出来的 FileList 里抽出所有 Markdown。
 * Obsidian / Notion / Typora 导出的都是一个塞满 .md 的文件夹，所以这一条路就够通吃。
 */
export async function readMarkdownFolder(files: FileList | File[]): Promise<ImportedDoc[]> {
  const list = Array.from(files).filter((f) => /\.(md|markdown|txt)$/i.test(f.name))
  const out: ImportedDoc[] = []
  for (const f of list) {
    try {
      const content = await f.text()
      out.push({ title: f.name.replace(/\.(md|markdown|txt)$/i, ''), content })
    } catch {
      /* 读不了就跳过，别让一个坏文件毁掉整次导入 */
    }
  }
  return out
}
