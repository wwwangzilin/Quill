/**
 * 自动更新。
 *
 * **更新包必须带 minisign 签名**：公钥写在 tauri.conf.json 里，私钥只存在 CI 的
 * GitHub Secrets 里。验签不过就直接拒绝安装 —— 所以就算更新源被人换掉，
 * 也塞不进一个假包。
 *
 * 更新源是 GitHub Release 上的 `latest.json`（正式版）。pre-release 不会推给用户，
 * 免得把开发中的版本硬塞给人。
 */
import { isDesktop } from './desktop'

export interface UpdateInfo {
  version: string
  currentVersion: string
  notes: string
  date: string | null
}

/** 查有没有新版本；返回 null 表示已经是最新（或者不在桌面版） */
export async function checkUpdate(): Promise<UpdateInfo | null> {
  if (!isDesktop()) return null
  const { check } = await import('@tauri-apps/plugin-updater')
  const update = await check()
  if (!update) return null
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? '',
    date: update.date ?? null,
  }
}

/**
 * 下载并安装，装完自动重启。
 * onProgress 收的是 (已下载字节, 总字节)；总字节拿不到时是 0。
 */
export async function installUpdate(
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (!isDesktop()) throw new Error('只有桌面版能自动更新')
  const { check } = await import('@tauri-apps/plugin-updater')
  const { relaunch } = await import('@tauri-apps/plugin-process')
  const update = await check()
  if (!update) return

  let done = 0
  let total = 0
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? 0
      onProgress?.(0, total)
    } else if (event.event === 'Progress') {
      done += event.data.chunkLength
      onProgress?.(done, total)
    }
  })
  await relaunch()
}

/** 当前版本（编译时写进去的那个） */
export async function currentVersion(): Promise<string> {
  if (!isDesktop()) return '开发预览'
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    return await getVersion()
  } catch {
    return '未知'
  }
}
