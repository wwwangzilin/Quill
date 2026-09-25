import { invoke } from '@tauri-apps/api/core'
import { docToMarkdown } from './markdown'
import { parseDocument } from './md-parse'
import type { Comment } from './comments'
import type { CommitInfo, DocStorage, RemoteInfo, TrashItem } from './storage'
import { emptyContent, type Doc, type DocMeta } from './types'

/** Rust 侧 list_docs 的返回结构 */
interface DocEntry {
  file: string
  title: string
  created: number
  updated: number
  size: number
  starred: boolean
  tags: string[]
  chars: number
}

interface SaveResult {
  file: string
  commit: string | null
}

export interface VaultInfo {
  path: string
  docs: number
  has_git: boolean
}

let info: VaultInfo | null = null

export function vaultInfo(): VaultInfo | null {
  return info
}

function metaOf(entry: DocEntry): DocMeta {
  return {
    id: entry.file,
    title: entry.title,
    createdAt: entry.created,
    updatedAt: entry.updated,
    starred: entry.starred,
    tags: entry.tags,
    chars: entry.chars,
  }
}

async function findEntry(id: string): Promise<DocEntry | undefined> {
  const rows = await invoke<DocEntry[]>('list_docs')
  return rows.find((r) => r.file === id)
}

export const vaultStorage: DocStorage = {
  kind: 'vault',
  get label() {
    return info?.path ?? '文档仓库'
  },

  async init() {
    info = await invoke<VaultInfo>('vault_info')
  },

  async list() {
    const rows = await invoke<DocEntry[]>('list_docs')
    return rows.map(metaOf)
  },

  async get(id) {
    const md = await invoke<string>('read_doc', { file: id })
    // 一次到位：标题和 frontmatter 都从 parseDocument 出。
    // 分成 splitTitle + markdownToDoc 两步的话，元数据会在第一步被剥掉。
    const { title, doc } = parseDocument(md)
    const entry = await findEntry(id)
    return {
      id,
      title: title || entry?.title || '未命名',
      createdAt: entry?.created ?? Date.now(),
      updatedAt: entry?.updated ?? Date.now(),
      starred: entry?.starred ?? false,
      content: doc,
    }
  },

  /**
   * 只取原文，不解析成 JSONContent。
   *
   * 给「超大文档」用：700 万字解析出来是二十多万个块，光这一步就够卡死，
   * 而阅读并不需要那个对象图。要走轻量通道的文档先在这里摸一下大小。
   */
  async raw(id) {
    return await invoke<string>('read_doc', { file: id })
  },

  async create(title) {
    const entry = await invoke<DocEntry>('create_doc', { title })
    return { ...metaOf(entry), content: emptyContent() }
  },

  async put(doc: Doc) {
    const md = docToMarkdown(doc.content, doc.title)
    const res = await invoke<SaveResult>('save_doc', {
      file: doc.id,
      title: doc.title,
      content: md,
    })
    return { id: res.file }
  },

  async remove(id) {
    await invoke('delete_doc', { file: id })
  },

  async star(id, starred) {
    await invoke('star_doc', { file: id, starred })
  },

  async setTags(id, tags) {
    await invoke('set_tags', { file: id, tags })
  },

  async allTags() {
    return await invoke<string[]>('all_tags')
  },

  async trash() {
    return await invoke<TrashItem[]>('list_trash')
  },

  async restoreTrash(name) {
    return await invoke<string>('restore_trash', { name })
  },

  async purgeTrash(name) {
    await invoke('purge_trash', { name })
  },

  async emptyTrash() {
    await invoke('empty_trash')
  },

  async recordWriting(date, chars) {
    await invoke('record_writing', { date, chars })
  },

  async writingStats() {
    return await invoke<Record<string, number>>('writing_stats')
  },

  async history(limit = 80) {
    return await invoke<CommitInfo[]>('git_history', { limit })
  },

  async fileAt(hash, id) {
    return await invoke<string>('git_file_at', { hash, file: id })
  },

  async restore(hash, id) {
    await invoke('git_restore', { hash, file: id })
  },

  async reveal() {
    await invoke('reveal_vault')
  },

  async remoteInfo() {
    return await invoke<RemoteInfo>('git_remote_info')
  },

  async saveGitSettings(url, ca, token) {
    await invoke('save_git_settings', {
      url,
      ca: ca ?? null,
      token: token ?? null,
    })
  },

  async pushNow() {
    return await invoke<string>('git_push_now')
  },

  async saveAsset(name, data) {
    return await invoke<string>('save_asset', { name, data })
  },

  async comments(id) {
    return await invoke<Comment[]>('doc_comments', { file: id })
  },

  async setComments(id, list) {
    await invoke('set_doc_comments', { file: id, comments: list })
  },
}
