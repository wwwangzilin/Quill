/**
 * 「磁盘上的这一篇，还是不是我看到的这一版」—— 外部修改检测的公共类型。
 *
 * 单独一个文件是为了断开循环依赖：storage.ts 要 import storage-vault.ts 的实现，
 * storage-vault.ts 又要抛这里的错误类。类型和错误类放进任何一边都会绕回来。
 */

/** 磁盘上某篇文档此刻的样子（Rust `doc_stamp` 的返回） */
export interface DocStamp {
  exists: boolean
  /** 整篇正文的 FNV-1a 32 */
  digest: number
  size: number
  /** 修改时间（毫秒） */
  modified: number
}

/** 摘要：只留冲突检测要用的两个数，别把整个 stamp 揣得到处都是 */
export interface DiskMark {
  digest: number
  size: number
}

export type ConflictCode = 'conflict' | 'deleted'

/** 弹给用户看的那一份冲突材料 */
export interface ConflictInfo {
  code: ConflictCode
  /** 冲突发生时的文件名（也是当时的 doc.id） */
  docId: string
  title: string
  /** 我的未保存版本（Markdown 原文） */
  mine: string
  /** 磁盘上的版本；`deleted` 时为 null */
  disk: string | null
  /** 外部改名后按摘要认回的新文件名 */
  renamedTo: string | null
  /**
   * 三方合并的结果（base = 上次保存时的样子）。
   * `conflicts === 0` 表示两边改的是不同段落，可以直接合。
   */
  merge?: { merged: string; conflicts: number }
  at: number
}

/**
 * 保存被拒：不是写不进去，而是**磁盘上已经不是我看到的那一版了**。
 *
 * 两种：
 * - `conflict`：外部改过，`disk` 里带着磁盘上那份正文，直接用来看对比
 * - `deleted`：文件被外部删掉或改名了 —— 这时千万别照着老文件名再写一个新的空壳
 */
export class SaveConflictError extends Error {
  readonly code: ConflictCode
  readonly disk: string | null
  readonly digest: number | null

  constructor(code: ConflictCode, disk: string | null = null, digest: number | null = null) {
    super(
      code === 'deleted'
        ? '文件已经不在仓库里了（被外部删除或改名）'
        : '这篇文档在外部被改过了',
    )
    this.name = 'SaveConflictError'
    this.code = code
    this.disk = disk
    this.digest = digest
  }
}

/**
 * Tauri 的 `Err` 抛出来是**序列化后的对象**，不是 Error 实例 ——
 * Rust 侧 SaveError 的形状是 `{ code, message, disk?, digest? }`。
 * 别的错误（字符串、Error）原样返回 null，交给调用方按普通失败处理。
 */
export function asSaveConflict(err: unknown): SaveConflictError | null {
  if (err instanceof SaveConflictError) return err
  if (!err || typeof err !== 'object') return null
  const e = err as { code?: unknown; disk?: unknown; digest?: unknown }
  if (e.code !== 'conflict' && e.code !== 'deleted') return null
  const disk = typeof e.disk === 'string' ? e.disk : null
  const digest = typeof e.digest === 'number' ? e.digest : null
  return new SaveConflictError(e.code, disk, digest)
}
