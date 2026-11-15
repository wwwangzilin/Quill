import { invoke } from '@tauri-apps/api/core'
import { docToMarkdown } from './markdown'
import { parseDocument } from './md-parse'
import type { Comment } from './comments'
import type { RawChapter } from './rawChapters'
import type { CommitInfo, ContextChunk, DocStorage, RemoteInfo, TrashItem } from './storage'
import { asSaveConflict, type DocStamp } from './docGuard'
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
  digest: number
  size: number
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
      /*
       * ⚠️ tags 一个都不能漏。
       *
       * 漏了的后果很隐蔽：打标签走 setTagsFor，那里是**乐观更新**，当场看得见；
       * 可**重新打开这一篇**走的是这儿 —— tags 变 undefined，标签栏就空了。
       * 表现正是「打了 tag 重新打开会掉」，而磁盘上的 .quill-meta.json 其实是好的、
       * git 里也躺着一串「标签《…》」的提交。查的时候先看 meta，别急着怀疑写盘。
       */
      tags: entry?.tags ?? [],
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

  /**
   * 超大文档的章节目录。Rust 侧流式扫一遍，只回几百个小对象 ——
   * 别在 IPC 上搬 21MB 的原文。
   */
  async outline(id) {
    return await invoke<{ marks: RawChapter[]; bytes: number }>('doc_outline', { file: id })
  },

  /** 只读一段（字节区间）。按章取正文用，一次最多几十 KB。 */
  async readSlice(id, from, to) {
    return await invoke<string>('read_doc_slice', { file: id, from, to })
  },

  /**
   * 把改好的一章写回原书（替换 `[from, to)` 这一段）。
   *
   * `expectDigest` 是摘走时那一段的 FNV-1a 32：Rust 侧先核对，
   * 对不上就拒绝 —— 免得在一本已经变过的书上按老坐标覆盖，把别处的改动抹掉。
   */
  async writeSlice(id, from, to, text, expectDigest) {
    return await invoke<number>('write_doc_slice', { file: id, from, to, text, expectDigest })
  },

  async create(title) {
    const entry = await invoke<DocEntry>('create_doc', { title })
    return { ...metaOf(entry), content: emptyContent() }
  },

  /**
   * 保存。
   *
   * 带上 `baseDigest` 就**先核对磁盘**：文件被外部改过 / 删掉了，Rust 侧一个字都不写，
   * 直接把 `{ code, message, disk, digest }` 抛上来，这里转成 SaveConflictError。
   * 不带就是「按我的覆盖」—— 恢复、合并这类用户已经拍板过的路径才用它。
   */
  async put(doc: Doc, opts?: { baseDigest?: number | null }) {
    const md = docToMarkdown(doc.content, doc.title)
    try {
      const res = await invoke<SaveResult>('save_doc', {
        file: doc.id,
        title: doc.title,
        content: md,
        baseDigest: opts?.baseDigest ?? null,
      })
      return { id: res.file, digest: res.digest, size: res.size }
    } catch (err) {
      // Tauri 的 Err 是序列化后的对象，不是 Error —— 得自己掰开认
      const conflict = asSaveConflict(err)
      if (conflict) throw conflict
      throw err
    }
  },

  /** 磁盘上这一篇此刻的摘要（打开文档、窗口重新聚焦时各查一次） */
  async stamp(id: string) {
    return await invoke<DocStamp>('doc_stamp', { file: id })
  },

  /** 外部改名：按「摘要 + 大小」在仓库里找回同一篇 */
  async findByDigest(digest: number, size: number) {
    return await invoke<string | null>('find_doc_by_digest', { digest, size })
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

  /**
   * 全库问答：先关键词召回，再由前端拼进提示词。
   *
   * 检索放在 Rust 侧（fulltext.rs）：那边只扫文件，不建对象图；
   * 前端只负责把结果编号、拼成材料、在看答案时把 [n] 换成能点的出处。
   */
  async context(query: string, limit = 8) {
    return await invoke<ContextChunk[]>('ai_context', { query, limit })
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
