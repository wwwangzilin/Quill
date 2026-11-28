/**
 * 命令面板里的「一键」动作：不用进设置页就能同步 / 备份。
 * 都是桌面版专属；没配置好就给一句人话，而不是静默什么都不发生。
 */
import { toast } from '../ui/toast'
import { isDesktop } from './desktop'
import { readCfg, runSync, summarize } from './webdavSync'
import { backupNow as doBackup } from './backup'
import { storage } from './storage'
import { loadStats } from './readStats'
import { readBookmarks } from './bookmarks'
import { readPos } from './lastPos'
import { readingCsv, type ReadingRow } from './readingCsv'
import { STATUS_LIST, effectiveStatus, loadStatuses } from './shelfStatus'

let syncing = false

export async function syncWebdavNow(): Promise<void> {
  if (!isDesktop()) return void toast.info('WebDAV 同步只在桌面版可用')
  const cfg = readCfg()
  if (!cfg.url.trim()) return void toast.info('还没配置 WebDAV', '到 设置 → WebDAV 同步 里填好地址再试')
  if (syncing) return void toast.info('正在同步中')
  syncing = true
  try {
    toast.info('开始同步', '在后台进行，完成会提醒')
    const r = await runSync(cfg)
    const text = summarize(r)
    if (r.errors.length || r.conflicts.length) toast.info('同步完成，有需要留意的', text)
    else toast.success('同步完成', text)
  } catch (e) {
    toast.error('同步失败', e instanceof Error ? e.message : String(e))
  } finally {
    syncing = false
  }
}

export async function backupNowAction(): Promise<void> {
  if (!isDesktop()) return void toast.info('备份只在桌面版可用')
  try {
    const info = await doBackup()
    toast.success('备份完成', info?.name ?? '')
  } catch (e) {
    toast.error('备份失败', e instanceof Error ? e.message : String(e))
  }
}

/** 把每本书的阅读时长、进度、批注 / 书签数、书架状态导成一份 CSV（Excel 直接能开） */
export async function exportReadingCsvAction(): Promise<void> {
  try {
    const docs = await storage.list()
    const stats = loadStats()
    const manual = loadStatuses()
    const rows: ReadingRow[] = []
    for (const d of docs) {
      const b = stats.books[d.id]
      const st = effectiveStatus(manual[d.id], b)
      let comments = 0
      try {
        comments = ((await storage.comments?.(d.id)) ?? []).length
      } catch {
        /* 读不出就算 0 */
      }
      const bookmarks = readBookmarks(d.id).length
      // 没读过、没批注、没标状态的书不进表，免得几百行全是空的
      if (!b && !st && !comments && !bookmarks) continue
      rows.push({
        title: d.title,
        chapter: readPos(d.id)?.chapter,
        secs: b?.secs ?? 0,
        first: b?.first,
        last: b?.last,
        done: b?.done,
        comments,
        bookmarks,
        status: STATUS_LIST.find((x) => x.id === st)?.name,
      })
    }
    if (!rows.length) return void toast.info('还没有阅读记录可导出')
    const blob = new Blob([readingCsv(rows)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '阅读记录.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
    toast.success('已导出阅读记录', `${rows.length} 本书 · 阅读记录.csv`)
  } catch (e) {
    toast.error('导出失败', e instanceof Error ? e.message : String(e))
  }
}
