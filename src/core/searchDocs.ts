/**
 * 跨文档全文搜索。
 *
 * 命令面板（Ctrl+P）只匹配文档**标题**，FindBar（Ctrl+F）只搜**当前这一篇** ——
 * 「我三个月前是不是写过这么一句」一直无解，这个模块补的就是这一环。
 *
 * 真正扫文件的是 Rust 侧（几百个文件毫秒级），这里只负责调用与类型。
 * 之所以不在前端做：那得先把所有 .md 读进内存，开一次搜索就拖几百 KB 进来，
 * 而这件事 Rust 干得快得多，还不用过 IPC。
 */
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './windows'

export interface DocSearchHit {
  file: string
  title: string
  /**
   * 关键词在这篇文档里第几次出现（0 基）。
   * 跳转靠它：打开文档后由编辑器自己再扫一遍，取第 nth 个匹配，
   * 而不是把 Markdown 行号换算成 ProseMirror 位置 —— 那个换算不可靠。
   */
  nth: number
  /** 1 基行号，只是显示给人看 */
  line: number
  snippet: string
}

export interface DocSearchResult {
  hits: DocSearchHit[]
  /** 扫了几篇 */
  files: number
  /** 命中总数（可能多于返回条数） */
  total: number
  truncated: boolean
}

const EMPTY: DocSearchResult = { hits: [], files: 0, total: 0, truncated: false }

/** 在仓库所有文档的正文里找一句话。网页预览里没有文件系统，返回空表。 */
export async function searchVault(query: string, limit = 200): Promise<DocSearchResult> {
  const q = query.trim()
  if (!q || !isTauri()) return EMPTY
  try {
    return await invoke<DocSearchResult>('search_vault', { query: q, limit })
  } catch (e) {
    console.warn('全文搜索失败', e)
    return EMPTY
  }
}
