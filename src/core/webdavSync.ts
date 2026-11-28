/**
 * WebDAV 同步的执行层：发请求（经 Rust 的 webdav_request，绕开 CORS）、
 * 读写本地文档，决策交给 core/webdav.ts。范围与取舍见那个文件顶部。
 */
import { invoke } from '@tauri-apps/api/core'
import { storage } from './storage'
import { importMarkdown } from './desktop'
import { readBookmarks, writeBookmarks } from './bookmarks'
import { clearPendingRemotePos, getActiveReaderId, readPos, setPendingRemotePos, setPosRaw } from './lastPos'
import { PROGRESS_REMOTE, emptyProgress, mergeProgress, parseProgress, progressEqual, type ProgressSnap } from './progress'
import {
  META_REMOTE,
  conflictName,
  dirUrl,
  fileUrl,
  emptyMeta,
  isAssetName,
  isSyncName,
  mergeMeta,
  metaDiff,
  metaEqual,
  parseMeta,
  parsePropfind,
  planAssets,
  planSync,
  sameText,
  type BaseRec,
  type RemoteEntry,
  type SyncMeta,
} from './webdav'

export interface DavCfg {
  url: string
  user: string
  pass: string
}

const CFG_KEY = 'quill-set:webdav'
const BASE_KEY = 'quill-set:webdav-base'
const LAST_KEY = 'quill-set:webdav-last'
const PREBACKUP_KEY = 'quill-set:webdav-prebackup'

/** 同步要覆盖本地文档之前先做一次整库备份（默认开）。没有覆盖就不备份，不会天天产生 zip。 */
export function readPreBackup(): boolean {
  try {
    return localStorage.getItem(PREBACKUP_KEY) !== '0'
  } catch {
    return true
  }
}
export function savePreBackup(on: boolean): void {
  try {
    localStorage.setItem(PREBACKUP_KEY, on ? '1' : '0')
  } catch {
    /* 记不住而已 */
  }
}

export function readCfg(): DavCfg {
  try {
    const o = JSON.parse(localStorage.getItem(CFG_KEY) ?? '{}') as Partial<DavCfg>
    return { url: o.url ?? '', user: o.user ?? '', pass: o.pass ?? '' }
  } catch {
    return { url: '', user: '', pass: '' }
  }
}
export function saveCfg(c: DavCfg): void {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(c))
  } catch {
    /* 记不住而已 */
  }
}
export function readLast(): { at: number; summary: string } | null {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null')
  } catch {
    return null
  }
}

interface DavResp {
  status: number
  headers: [string, string][]
  body: string
}

async function dav(
  cfg: DavCfg,
  method: string,
  url: string,
  extra: { headers?: [string, string][]; body?: string } = {},
): Promise<DavResp> {
  return await invoke<DavResp>('webdav_request', {
    req: { method, url, user: cfg.user, pass: cfg.pass, headers: extra.headers ?? [], body: extra.body ?? null },
  })
}

const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:getcontentlength/><d:getlastmodified/><d:resourcetype/></d:prop></d:propfind>'

const explain = (r: DavResp): string => {
  if (r.status === 401) return '账号或密码不对（401）'
  if (r.status === 403) return '没有权限（403）'
  if (r.status === 405) return '这个地址不支持 WebDAV（405），请确认填的是 WebDAV 目录地址'
  return `服务器返回 ${r.status}`
}

/** 列远端目录；目录不存在就建出来 */
async function listRemote(cfg: DavCfg): Promise<RemoteEntry[]> {
  const base = dirUrl(cfg.url)
  const ask = () =>
    dav(cfg, 'PROPFIND', base, {
      headers: [
        ['Depth', '1'],
        ['Content-Type', 'application/xml; charset=utf-8'],
      ],
      body: PROPFIND_BODY,
    })
  let r = await ask()
  if (r.status === 404) {
    const mk = await dav(cfg, 'MKCOL', base)
    if (mk.status >= 300) throw new Error(`远端目录不存在，也建不出来：${explain(mk)}`)
    r = await ask()
  }
  if (r.status !== 207 && r.status !== 200) throw new Error(explain(r))
  return parsePropfind(r.body, base)
}

export async function testConnection(cfg: DavCfg): Promise<string> {
  if (!cfg.url.trim()) throw new Error('先填 WebDAV 地址')
  const list = await listRemote(cfg)
  return `连上了，远端目录里有 ${list.filter((e) => !e.isDir && isSyncName(e.name)).length} 篇文档`
}

export interface SyncReport {
  pushed: string[]
  pulled: string[]
  conflicts: string[]
  unchanged: number
  errors: { name: string; msg: string }[]
  /** 元数据（标签 / 星标 / 批注）这次从远端补到本地的条数 */
  metaPulled: number
  /** 阅读位置 / 书签这次从别的设备补进本机的条数 */
  progressPulled: number
  /** 当前正在读、暂不自动覆盖的远端位置数。 */
  progressPending: number
  /** 图片上传 / 下载 / 跳过的张数 */
  assets: { pushed: number; pulled: number; skipped: string[] }
}

const sigOf = (m: { updatedAt: number; chars?: number }) => `${m.updatedAt}:${m.chars ?? 0}`

function readBase(url: string): Record<string, BaseRec> {
  try {
    const all = JSON.parse(localStorage.getItem(BASE_KEY) ?? '{}') as Record<string, Record<string, BaseRec>>
    return all[dirUrl(url)] ?? {}
  } catch {
    return {}
  }
}
function writeBase(url: string, rec: Record<string, BaseRec>): void {
  try {
    const all = JSON.parse(localStorage.getItem(BASE_KEY) ?? '{}') as Record<string, Record<string, BaseRec>>
    all[dirUrl(url)] = rec
    localStorage.setItem(BASE_KEY, JSON.stringify(all))
  } catch {
    /* 下次会多做一次 compare，不会出错 */
  }
}

export function summarize(r: SyncReport): string {
  const parts = [
    r.pushed.length && `上传 ${r.pushed.length}`,
    r.pulled.length && `下载 ${r.pulled.length}`,
    r.conflicts.length && `冲突 ${r.conflicts.length}`,
    r.metaPulled && `标签/批注补入 ${r.metaPulled}`,
    r.progressPending && `远端阅读进度待确认 ${r.progressPending} 本`,
    r.progressPulled && `进度/书签补入 ${r.progressPulled}`,
    r.assets.pushed && `传图 ${r.assets.pushed}`,
    r.assets.pulled && `收图 ${r.assets.pulled}`,
    r.errors.length && `失败 ${r.errors.length}`,
  ].filter(Boolean)
  return parts.length ? parts.join('，') : `已是最新（${r.unchanged} 篇没变）`
}

export async function runSync(cfg: DavCfg, onStep?: (msg: string) => void): Promise<SyncReport> {
  if (!storage.raw) throw new Error('WebDAV 同步只在桌面版可用')
  const report: SyncReport = {
    pushed: [],
    pulled: [],
    conflicts: [],
    unchanged: 0,
    errors: [],
    metaPulled: 0,
    progressPulled: 0,
    progressPending: 0,
    assets: { pushed: 0, pulled: 0, skipped: [] },
  }
  // 第一次要覆盖本地文档前备份一次；备份失败不拦同步（只提示），但会在报告里留一句
  let backedUp = false
  const backupOnce = async () => {
    if (backedUp || !readPreBackup()) return
    backedUp = true
    try {
      onStep?.('覆盖本地前先备份')
      await invoke('backup_now')
    } catch (e) {
      report.errors.push({ name: '同步前备份', msg: `失败，已继续同步：${e instanceof Error ? e.message : String(e)}` })
    }
  }
  const base = readBase(cfg.url)
  const failed = new Set<string>()
  const metaOf = new Map<string, { title: string }>()

  // 最多两轮：第一轮解决冲突时会生成「冲突副本」，第二轮顺手把它传上去
  for (let round = 0; round < 2; round += 1) {
    onStep?.(round ? '再对一遍…' : '读取远端目录…')
    const remoteList = (await listRemote(cfg)).filter((e) => !e.isDir && isSyncName(e.name))
    const locals = (await storage.list()).filter((m) => isSyncName(m.id))
    locals.forEach((m) => metaOf.set(m.id, { title: m.title }))
    const plan = planSync(
      new Map(locals.map((m) => [m.id, { sig: sigOf(m) }])),
      new Map(remoteList.map((e) => [e.name, { tag: e.tag }])),
      base,
    ).filter((p) => !failed.has(p.name))

    let acted = 0
    for (const item of plan) {
      const { name } = item
      if (item.op === 'skip') {
        if (round === 0) report.unchanged += 1
        continue
      }
      try {
        onStep?.(`${item.op === 'push' ? '上传' : item.op === 'pull' ? '下载' : '比对'} ${name}`)
        const stem = name.replace(/\.md$/i, '')
        const pull = async (text: string) => {
          const existing = metaOf.get(name)
          if (existing) {
            await backupOnce()
            await invoke('save_doc', { file: name, title: existing.title, content: text, baseDigest: null })
          } else {
            await importMarkdown([{ title: stem, content: text }])
          }
        }
        if (item.op === 'push') {
          const text = await storage.raw(name)
          const r = await dav(cfg, 'PUT', fileUrl(cfg.url, name), {
            headers: [['Content-Type', 'text/markdown; charset=utf-8']],
            body: text,
          })
          if (r.status >= 300) throw new Error(explain(r))
          report.pushed.push(name)
          acted += 1
        } else if (item.op === 'pull') {
          const r = await dav(cfg, 'GET', fileUrl(cfg.url, name))
          if (r.status >= 300) throw new Error(explain(r))
          await pull(r.body)
          report.pulled.push(name)
          acted += 1
        } else {
          // compare：拉下远端逐字比，一样只补记账，不一样才起冲突副本
          const r = await dav(cfg, 'GET', fileUrl(cfg.url, name))
          if (r.status >= 300) throw new Error(explain(r))
          const mine = await storage.raw(name)
          if (!sameText(mine, r.body)) {
            const copy = conflictName(name, new Date())
            await importMarkdown([{ title: copy.replace(/\.md$/i, ''), content: mine }])
            await pull(r.body)
            report.conflicts.push(name)
            acted += 1
          } else if (round === 0) {
            report.unchanged += 1
          }
        }
      } catch (e) {
        failed.add(name)
        report.errors.push({ name, msg: e instanceof Error ? e.message : String(e) })
      }
    }

    // 记账：两边都有、且没出错的，记下此刻两边的指纹，下次据此判断谁动过
    const after = (await listRemote(cfg)).filter((e) => !e.isDir && isSyncName(e.name))
    const mineNow = new Map((await storage.list()).map((m) => [m.id, sigOf(m)]))
    for (const e of after) {
      const l = mineNow.get(e.name)
      if (l !== undefined && !failed.has(e.name)) base[e.name] = { l, r: e.tag }
    }
    writeBase(cfg.url, base)
    // 第二轮只在第一轮真的动过东西时才有必要（冲突副本要传）
    if (!acted || report.conflicts.length === 0) break
  }

  // 文档之后再同步元数据和图片：文档拉下来了，它们的标签 / 批注才有地方落
  await syncMeta(cfg, report, onStep)
  await syncProgress(cfg, report, onStep)
  await syncAssets(cfg, report, onStep)

  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ at: Date.now(), summary: summarize(report) }))
  } catch {
    /* 无所谓 */
  }
  return report
}

/* ------------------------------ 元数据：标签 / 星标 / 批注 ------------------------------ */

async function readLocalMeta(): Promise<{ meta: SyncMeta; names: Set<string> }> {
  const docs = (await storage.list()).filter((m) => isSyncName(m.id))
  const meta = emptyMeta()
  for (const m of docs) {
    if (m.starred) meta.starred.push(m.id)
    if (m.tags?.length) meta.tags[m.id] = [...m.tags]
    const c = storage.comments ? await storage.comments(m.id).catch(() => []) : []
    if (c.length) meta.comments[m.id] = c as SyncMeta['comments'][string]
  }
  meta.starred.sort()
  return { meta, names: new Set(docs.map((m) => m.id)) }
}

async function syncMeta(cfg: DavCfg, report: SyncReport, onStep?: (m: string) => void): Promise<void> {
  try {
    onStep?.('同步标签与批注…')
    const url = fileUrl(cfg.url, META_REMOTE)
    const got = await dav(cfg, 'GET', url)
    const remote = got.status === 404 ? emptyMeta() : got.status < 300 ? parseMeta(got.body) : null
    if (!remote) throw new Error(explain(got))
    const { meta: local, names } = await readLocalMeta()
    const merged = mergeMeta(local, remote, names)
    const diff = metaDiff(local, merged)
    for (const id of diff.star) {
      await storage.star(id, true)
      report.metaPulled += 1
    }
    for (const [id, tags] of Object.entries(diff.tags)) {
      await storage.setTags(id, tags)
      report.metaPulled += 1
    }
    for (const [id, list] of Object.entries(diff.comments)) {
      await storage.setComments?.(id, list as never)
      report.metaPulled += 1
    }
    // 远端那份和合并结果不一样才写回（没变就别白占一次上传）
    if (got.status === 404 || !metaEqual(remote, merged)) {
      const put = await dav(cfg, 'PUT', url, {
        headers: [['Content-Type', 'application/json; charset=utf-8']],
        body: JSON.stringify(merged),
      })
      if (put.status >= 300) throw new Error(explain(put))
    }
  } catch (e) {
    report.errors.push({ name: '标签 / 批注', msg: e instanceof Error ? e.message : String(e) })
  }
}

/* ------------------------------ assets/ 图片 ------------------------------ */

interface AssetInfo {
  name: string
  size: number
}

async function syncAssets(cfg: DavCfg, report: SyncReport, onStep?: (m: string) => void): Promise<void> {
  try {
    onStep?.('同步图片…')
    const local = await invoke<AssetInfo[]>('list_assets')
    const dir = dirUrl(cfg.url) + 'assets/'
    const ask = () =>
      dav(cfg, 'PROPFIND', dir, {
        headers: [
          ['Depth', '1'],
          ['Content-Type', 'application/xml; charset=utf-8'],
        ],
        body: PROPFIND_BODY,
      })
    let r = await ask()
    if (r.status === 404) {
      // 本地也没图就不必为此在远端建目录
      if (!local.length) return
      const mk = await dav(cfg, 'MKCOL', dir)
      if (mk.status >= 300) throw new Error(`远端建不出 assets 目录：${explain(mk)}`)
      r = await ask()
    }
    if (r.status !== 207 && r.status !== 200) throw new Error(explain(r))
    const remote = parsePropfind(r.body, dir)
      .filter((e) => !e.isDir && isAssetName(e.name))
      .map((e) => ({ name: e.name, size: e.size }))
    const plan = planAssets(local.filter((a) => isAssetName(a.name)), remote)
    report.assets.skipped = plan.skipped.map((s) => `${s.name}（${s.why}）`)
    const auth = { user: cfg.user, pass: cfg.pass }
    for (const name of plan.push) {
      try {
        onStep?.(`传图 ${name}`)
        const st = await invoke<number>('webdav_put_asset', { url: dir + encodeURIComponent(name), auth, name })
        if (st >= 300) throw new Error(`服务器返回 ${st}`)
        report.assets.pushed += 1
      } catch (e) {
        report.errors.push({ name, msg: e instanceof Error ? e.message : String(e) })
      }
    }
    for (const name of plan.pull) {
      try {
        onStep?.(`收图 ${name}`)
        const st = await invoke<number>('webdav_get_asset', { url: dir + encodeURIComponent(name), auth, name })
        if (st >= 300) throw new Error(`服务器返回 ${st}`)
        report.assets.pulled += 1
      } catch (e) {
        report.errors.push({ name, msg: e instanceof Error ? e.message : String(e) })
      }
    }
  } catch (e) {
    report.errors.push({ name: '图片', msg: e instanceof Error ? e.message : String(e) })
  }
}

/* ------------------------------ 阅读进度 / 书签 ------------------------------ */

async function syncProgress(cfg: DavCfg, report: SyncReport, onStep?: (m: string) => void): Promise<void> {
  try {
    onStep?.('同步阅读进度…')
    const url = fileUrl(cfg.url, PROGRESS_REMOTE)
    const got = await dav(cfg, 'GET', url)
    const remote = got.status === 404 ? emptyProgress() : got.status < 300 ? parseProgress(got.body) : null
    if (!remote) throw new Error(explain(got))
    const names = (await storage.list()).filter((m) => isSyncName(m.id)).map((m) => m.id)
    const local: ProgressSnap = emptyProgress()
    for (const n of names) {
      const p = readPos(n)
      if (p) local.pos[n] = p
      const b = readBookmarks(n)
      if (b.length) local.bookmarks[n] = b
    }
    const { merged, posToApply, bookmarksToApply } = mergeProgress(local, remote, new Set(names))
    const activeId = getActiveReaderId()
    for (const [n, p] of Object.entries(posToApply)) {
      if (n === activeId && local.pos[n]) {
        // 当前正在读：先存成待确认位置，不能在翻页过程中静默改掉页码。
        setPendingRemotePos(n, p)
        report.progressPending += 1
      } else {
        setPosRaw(n, p)
        clearPendingRemotePos(n)
        report.progressPulled += 1
      }
    }
    if (activeId && !posToApply[activeId]) clearPendingRemotePos(activeId)
    for (const [n, b] of Object.entries(bookmarksToApply)) {
      writeBookmarks(n, b)
      report.progressPulled += 1
    }
    if (got.status === 404 || !progressEqual(remote, merged)) {
      const put = await dav(cfg, 'PUT', url, {
        headers: [['Content-Type', 'application/json; charset=utf-8']],
        body: JSON.stringify(merged),
      })
      if (put.status >= 300) throw new Error(explain(put))
    }
  } catch (e) {
    report.errors.push({ name: '阅读进度', msg: e instanceof Error ? e.message : String(e) })
  }
}
