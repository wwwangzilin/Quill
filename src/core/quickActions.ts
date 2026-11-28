/**
 * 命令面板里的「一键」动作：不用进设置页就能同步 / 备份。
 * 都是桌面版专属；没配置好就给一句人话，而不是静默什么都不发生。
 */
import { toast } from '../ui/toast'
import { isDesktop } from './desktop'
import { readCfg, runSync, summarize } from './webdavSync'
import { backupNow as doBackup } from './backup'

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
