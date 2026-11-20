import { invoke } from '@tauri-apps/api/core'
import { isDesktop } from './desktop'

/**
 * 本地备份（整库快照）。
 *
 * 和「远程备份」是两件事：那个是把仓库推到 git 远程，这个是在本机留几份 zip，
 * 防的是 `.git` 目录本身损坏、或者整个库目录被误删。
 */

export interface BackupPrefs {
  enabled: boolean
  /** 空串 = 用默认目录（文档目录下的 Quill Backups） */
  dir: string
  keep: number
  intervalHours: number
  lastAt: number
  lastOk: boolean
  lastError: string | null
  lastSize: number
  lastName: string
}

export interface BackupInfo {
  name: string
  size: number
  created: number
}

export interface BackupStatus {
  prefs: BackupPrefs
  dir: string
  count: number
  totalBytes: number
  writable: boolean
  dirError: string | null
}

export interface RestoreReport {
  snapshot: string | null
  displaced: string
}

const need = () => {
  if (!isDesktop()) throw new Error('备份只在桌面版可用')
}

export const backupStatus = async (): Promise<BackupStatus> => {
  need()
  return await invoke<BackupStatus>('backup_status')
}

export const backupSavePrefs = async (prefs: BackupPrefs): Promise<BackupStatus> => {
  need()
  return await invoke<BackupStatus>('backup_save_prefs', { prefs })
}

export const backupNow = async (): Promise<BackupInfo> => {
  need()
  return await invoke<BackupInfo>('backup_now')
}

export const backupList = async (): Promise<BackupInfo[]> => {
  need()
  return await invoke<BackupInfo[]>('backup_list')
}

export const backupDocs = async (name: string): Promise<string[]> => {
  need()
  return await invoke<string[]>('backup_docs', { name })
}

export const backupRestoreAll = async (name: string): Promise<RestoreReport> => {
  need()
  return await invoke<RestoreReport>('backup_restore_all', { name })
}

export const backupRestoreDoc = async (name: string, file: string): Promise<void> => {
  need()
  await invoke('backup_restore_doc', { name, file })
}

export const backupReveal = async (): Promise<void> => {
  need()
  await invoke('backup_reveal')
}

/** 1600000000000 → 2026-11-20 19:27 */
export function whenText(ts: number): string {
  if (!ts) return '还没备份过'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
