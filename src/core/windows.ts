import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

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
  try {
    await invoke('close_self')
  } catch {
    // 后端命令都调不动时，至少别让窗口卡在那儿
    window.close()
  }
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

/** 报到：告诉 Rust 侧这个子窗口已经渲染出来了（没报到会被看门狗关掉） */
export async function markWindowReady(): Promise<void> {
  if (!isTauri()) return
  try {
    await invoke('window_ready')
  } catch {
    /* 老版本后端没有这个命令，忽略 */
  }
}

const STICKY_PREFIX = 'sticky-'

export type WindowRole =
  | { kind: 'main' }
  | { kind: 'quicknote' }
  | { kind: 'sticky'; doc: string }

/** 当前窗口的 label —— 主窗口是 main，靠它分辨自己是谁，不依赖 URL */
function currentLabel(): string {
  try {
    return getCurrentWindow().label ?? ''
  } catch {
    return ''
  }
}

function decodeHex(hex: string): string | null {
  if (!hex || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  try {
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

function param(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name)
  } catch {
    return null
  }
}

/**
 * 我是哪种窗口？
 * 首选窗口 label（Rust 侧建窗口时就定好了），
 * URL 参数只作为兜底，免得哪天 label 拿不到就整个白屏。
 */
export function windowRole(): WindowRole {
  const label = currentLabel()
  if (label === 'quicknote') return { kind: 'quicknote' }
  if (label.startsWith(STICKY_PREFIX)) {
    const doc = decodeHex(label.slice(STICKY_PREFIX.length))
    if (doc) return { kind: 'sticky', doc }
  }

  if (param('w') === 'quicknote' || window.location.hash.startsWith('#quicknote')) {
    return { kind: 'quicknote' }
  }
  if (param('w') === 'sticky') {
    const doc = param('doc')
    if (doc) return { kind: 'sticky', doc }
  }
  const hash = window.location.hash
  if (hash.startsWith('#sticky=')) {
    try {
      return { kind: 'sticky', doc: decodeURIComponent(hash.slice('#sticky='.length)) }
    } catch {
      /* 解不出来就当主窗口 */
    }
  }
  return { kind: 'main' }
}
