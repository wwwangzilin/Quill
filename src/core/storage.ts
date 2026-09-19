import { openDB, type IDBPDatabase } from 'idb'
import { createDoc, type Doc, type DocMeta } from './types'
import { vaultStorage } from './storage-vault'

/** 一次提交（文件模式才有） */
export interface CommitInfo {
  hash: string
  short: string
  message: string
  time: number
  files: string[]
}

/** 回收站条目 */
export interface TrashItem {
  name: string
  original: string
  deleted: number
  size: number
}

/** 远程备份状态（只有文件模式有） */
export interface RemoteInfo {
  url: string | null
  /** 还没推上去的提交数；没有上游时为 null */
  ahead: number | null
  hasToken: boolean
  sslCa: string | null
}

/**
 * 存储抽象。
 * - 浏览器调试：IndexedDB（标签/回收站/统计落到 localStorage）
 * - Tauri 桌面版：磁盘上的 .md 文件 + git 仓库
 * 两套实现的 id 语义不同：前者是内部生成的 doc id，后者就是文件名。
 */
export interface DocStorage {
  kind: 'browser' | 'vault'
  label: string
  init(): Promise<void>
  list(): Promise<DocMeta[]>
  get(id: string): Promise<Doc | undefined>
  create(title: string): Promise<Doc>
  /** 保存；返回可能变化的新 id（文件模式按标题改名后会换文件名） */
  put(doc: Doc): Promise<{ id: string }>
  remove(id: string): Promise<void>
  star(id: string, starred: boolean): Promise<void>
  setTags(id: string, tags: string[]): Promise<void>
  allTags(): Promise<string[]>
  trash(): Promise<TrashItem[]>
  restoreTrash(name: string): Promise<string>
  purgeTrash(name: string): Promise<void>
  emptyTrash(): Promise<void>
  recordWriting(date: string, chars: number): Promise<void>
  writingStats(): Promise<Record<string, number>>
  history(limit?: number): Promise<CommitInfo[]>
  fileAt(hash: string, id: string): Promise<string>
  restore(hash: string, id: string): Promise<void>
  reveal(): Promise<void>
  /* ---- 远程备份（浏览器模式不提供） ---- */
  remoteInfo?(): Promise<RemoteInfo>
  saveGitSettings?(url: string, ca?: string, token?: string): Promise<void>
  pushNow?(): Promise<string>
  /** 把媒体写进仓库的 assets/，返回相对路径 */
  saveAsset?(name: string, data: string): Promise<string>
}

/* ------------------------- 浏览器：IndexedDB ------------------------- */

const DB_NAME = 'quill'
const STORE = 'docs'
const VERSION = 1
const TAGS_KEY = 'quill-set:tags'
const TRASH_KEY = 'quill-set:trash'
const STATS_KEY = 'quill-set:stats'

let handle: Promise<IDBPDatabase> | null = null

function db(): Promise<IDBPDatabase> {
  if (!handle) {
    handle = openDB(DB_NAME, VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) {
          const store = d.createObjectStore(STORE, { keyPath: 'id' })
          store.createIndex('updatedAt', 'updatedAt')
        }
      },
    })
  }
  return handle
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 忽略 */
  }
}

function toMeta(doc: Doc): DocMeta {
  return {
    id: doc.id,
    title: doc.title,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    starred: doc.starred,
  }
}

export const browserStorage: DocStorage = {
  kind: 'browser',
  label: '浏览器本地库（IndexedDB）',
  async init() {
    await db()
  },
  async list() {
    const all = (await (await db()).getAll(STORE)) as Doc[]
    const tags = readJson<Record<string, string[]>>(TAGS_KEY, {})
    return all
      .map((d) => ({ ...toMeta(d), tags: tags[d.id] ?? [] }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  },
  async get(id) {
    return (await (await db()).get(STORE, id)) as Doc | undefined
  },
  async create(title) {
    const doc = createDoc(title)
    await (await db()).put(STORE, doc)
    return doc
  },
  async put(doc) {
    await (await db()).put(STORE, doc)
    return { id: doc.id }
  },
  async remove(id) {
    const doc = (await (await db()).get(STORE, id)) as Doc | undefined
    if (doc) {
      const trash = readJson<TrashItem[]>(TRASH_KEY, [])
      trash.push({
        name: id,
        original: doc.title,
        deleted: Date.now(),
        size: JSON.stringify(doc.content).length,
      })
      writeJson(TRASH_KEY, trash)
    }
    await (await db()).delete(STORE, id)
  },
  async star(id, starred) {
    const doc = (await (await db()).get(STORE, id)) as Doc | undefined
    if (doc) await (await db()).put(STORE, { ...doc, starred })
  },
  async setTags(id, tags) {
    const all = readJson<Record<string, string[]>>(TAGS_KEY, {})
    if (tags.length) all[id] = tags
    else delete all[id]
    writeJson(TAGS_KEY, all)
  },
  async allTags() {
    const all = readJson<Record<string, string[]>>(TAGS_KEY, {})
    return [...new Set(Object.values(all).flat())].sort()
  },
  async trash() {
    return readJson<TrashItem[]>(TRASH_KEY, []).sort((a, b) => b.deleted - a.deleted)
  },
  async restoreTrash(name) {
    const trash = readJson<TrashItem[]>(TRASH_KEY, [])
    writeJson(
      TRASH_KEY,
      trash.filter((t) => t.name !== name),
    )
    return name
  },
  async purgeTrash(name) {
    const trash = readJson<TrashItem[]>(TRASH_KEY, [])
    writeJson(
      TRASH_KEY,
      trash.filter((t) => t.name !== name),
    )
  },
  async emptyTrash() {
    writeJson(TRASH_KEY, [])
  },
  async recordWriting(date, chars) {
    if (!chars) return
    const stats = readJson<Record<string, number>>(STATS_KEY, {})
    stats[date] = (stats[date] ?? 0) + chars
    writeJson(STATS_KEY, stats)
  },
  async writingStats() {
    return readJson<Record<string, number>>(STATS_KEY, {})
  },
  async history() {
    return []
  },
  async fileAt() {
    return ''
  },
  async restore() {
    /* 浏览器模式没有版本管理 */
  },
  async reveal() {
    /* no-op */
  },
}

/* ------------------------- 运行时选择 ------------------------- */

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export let storage: DocStorage = browserStorage

/** 在启动时调用一次：Tauri 里切到「.md 文件 + git」实现 */
export async function initStorage(): Promise<DocStorage> {
  storage = inTauri() ? vaultStorage : browserStorage
  await storage.init()
  return storage
}

export { vaultStorage }
