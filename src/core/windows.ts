import { invoke } from '@tauri-apps/api/core'

/** 是不是跑在桌面壳里 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** 唤起 / 收起快捷便签窗口 */
export async function toggleQuickNote(): Promise<void> {
  if (!isTauri()) return
  await invoke('toggle_quicknote')
}

export async function openQuickNote(): Promise<void> {
  if (!isTauri()) return
  await invoke('open_quicknote')
}

/** 把一篇文档钉成桌面磁贴 */
export async function openSticky(doc: string, title: string): Promise<void> {
  if (!isTauri()) return
  await invoke('open_sticky', { doc, title })
}

/** 小窗自己关自己 */
export async function closeSelf(): Promise<void> {
  if (!isTauri()) return
  await invoke('close_self')
}

/** 这篇文档是否已经钉在桌面上 */
export async function isSticky(doc: string): Promise<boolean> {
  if (!isTauri()) return false
  try {
    return await invoke<boolean>('is_sticky', { doc })
  } catch {
    return false
  }
}

/** 当前窗口是不是便签窗口 */
export function isQuickNoteWindow(): boolean {
  return window.location.hash.startsWith('#quicknote')
}

/** 当前窗口是不是磁贴窗口，是的话返回它对应的文档名 */
export function stickyDocOf(): string | null {
  const hash = window.location.hash
  if (!hash.startsWith('#sticky=')) return null
  try {
    return decodeURIComponent(hash.slice('#sticky='.length))
  } catch {
    return null
  }
}
