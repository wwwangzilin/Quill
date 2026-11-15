/**
 * App 拆分之后几个模块共用的类型。
 */

import type { RawChapter } from '../core/rawChapters'

/** `conflict` = 外部改动还没处理，这时自动保存是停着的 */
export type Saving = 'idle' | 'saving' | 'saved' | 'conflict'

/**
 * 超大文档：只揣一份章节目录，正文交给 ReaderView 按章现取。
 *
 * 刻意**不复用 `doc`** —— 那篇根本解析不成 JSONContent（二十多万个块）。
 * 但渲染走的还是同一个 ReaderView，所以界面跟普通小说一模一样。
 */
export interface HeavyOutline {
  id: string
  title: string
  marks: RawChapter[]
}
