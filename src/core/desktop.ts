/**
 * 桌面版专属能力：托盘行为偏好 / 开机自启 / 批量导入。
 * 浏览器调试模式下全部是安全空操作 —— 调用方先看 isDesktop()。
 */
import { invoke } from '@tauri-apps/api/core'
import { isImportable, readImportFile, type ImportedDoc } from './txtToMd'

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

/**
 * 把一个本地文件（拖进来的图片/视频）复制进仓库 assets/，返回相对路径。
 * 传路径而不是 base64：视频动辄上百 MB，编成 base64 再走 IPC 会白吃一份内存。
 */
export async function importAssetFile(path: string): Promise<string> {
  if (!isDesktop()) throw new Error('插入本地媒体只在桌面版可用')
  return await invoke<string>('import_asset_file', { path })
}

export type { ImportedDoc } from './txtToMd'

/**
 * 从一个文件选择框拿到的 FileList 里抽出所有能导入的文本。
 *
 * 两个来源都走这里：整个文件夹（Obsidian / Notion / Typora 导出的就是一堆 .md），
 * 以及零散挑的几个文件（.txt 自动转成 Markdown）。
 *
 * 注意**不要**用 `file.text()` —— 它一律按 UTF-8 解码，而中文 txt 十有八九是
 * GBK，那样读出来整篇都是乱码。走 readImportFile，它会先认编码。
 */
export async function readMarkdownFolder(files: FileList | File[]): Promise<ImportedDoc[]> {
  const list = Array.from(files).filter((f) => isImportable(f.name))
  const out: ImportedDoc[] = []
  for (const f of list) {
    try {
      out.push(await readImportFile(f))
    } catch {
      /* 读不了就跳过，别让一个坏文件毁掉整次导入 */
    }
  }
  return out
}
