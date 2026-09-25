/**
 * 上次读到哪儿。
 *
 * **存 localStorage，不进文档仓库**：阅读位置是「这台机器上的这个人的进度」，
 * 跟文档内容没关系。要是塞进 `.quill-meta.json`，那里面每次写都会触发一次
 * 自动 commit —— 等于把 git 历史当滚动日志用，翻两页就刷一串提交。
 * 代价是换机器就没了，这点跟 Word 一样（它的阅读位置也不跟着文件走）。
 *
 * 两个模式各记一份，互不干扰：
 *   · 正常模式：滚动位置 + 一个**文字锚点**（文档被改过也能凭它找回来）
 *   · 小说模式：停在哪一章的标题 + 第几屏
 * 章存标题不存序号 —— 中间插一章，序号就全错位了。
 */

export interface DocPos {
  /** 正常模式：滚动位置（像素） */
  scroll?: number
  /** 正常模式：读到全文的百分之几（给提示看的人话） */
  ratio?: number
  /** 正常模式：视口顶部那一段的开头文字 */
  anchor?: string
  /** 小说模式：停在哪一章（标题，不是序号） */
  chapter?: string
  /** 小说模式：这一章的第几屏（0 基） */
  page?: number
  at: number
}

const keyOf = (docId: string) => `quill:pos:${docId}`

/** 锚点最多存这么长 —— 越长越脆，够认出是哪一段就行 */
export const MAX_ANCHOR = 48

export function readPos(docId: string): DocPos | null {
  if (!docId) return null
  try {
    const raw = localStorage.getItem(keyOf(docId))
    if (!raw) return null
    const j = JSON.parse(raw) as DocPos
    return j && typeof j.at === 'number' ? j : null
  } catch {
    return null
  }
}

/**
 * 合并式写入：只覆盖传进来的字段。
 *
 * `undefined` 一律跳过 —— 不然「这次没带 chapter」会把上次记的章号抹掉，
 * 正常模式和小说模式共用一条记录时会互相踩。
 */
export function writePos(docId: string, patch: Partial<DocPos>): void {
  if (!docId) return
  try {
    const prev = readPos(docId) ?? { at: 0 }
    const next: Record<string, unknown> = { ...prev, at: Date.now() }
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) next[k] = v
    }
    localStorage.setItem(keyOf(docId), JSON.stringify(next))
  } catch {
    /* 存不下就算了 —— 记不住位置不该打扰写东西 */
  }
}

export function clearPos(docId: string): void {
  try {
    localStorage.removeItem(keyOf(docId))
  } catch {
    /* 同上 */
  }
}

/** 「读到哪儿了」的人话版本，给 toast 用 */
export function posLabel(p: DocPos): string {
  if (p.chapter) return `${p.chapter} · 第 ${(p.page ?? 0) + 1} 屏`
  if (typeof p.ratio === 'number' && p.ratio > 0.01) {
    return `大约 ${Math.round(p.ratio * 100)}% 处`
  }
  return '上次停的地方'
}
