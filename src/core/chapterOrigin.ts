/*
 * 「摘出来改」的来路。
 *
 * 摘出来的那一篇是**独立文档**，但它记得自己是从哪本书的哪一段来的 ——
 * 改完能按原区间并回去。
 *
 * 这份来路存 localStorage，不进文档正文：它是本机的编辑状态，不是文章内容，
 * 更不该跟着文档进那个要推远程的 git 仓库。
 */

export interface ChapterOrigin {
  /** 原书 docId（就是文件名） */
  srcId: string
  srcTitle: string
  /** 摘走时那一章在原文件里的**字节**区间 */
  from: number
  to: number
  /**
   * 摘走时那一段原文的 FNV-1a 32，合并前拿它核对。
   *
   * ⚠️ 别拿区间长度当校验：`to - from` 和摘走时的长度是**恒等**的，比了等于没比。
   * 原书前面被插了几行、from/to 整体偏了，长度照样对得上，然后写到错的地方去。
   */
  digest: number
  chapterTitle: string
  at: number
}

/**
 * FNV-1a 32 —— 必须和 Rust 侧 `vault::fnv1a32` **逐字节**一致。
 *
 * 算的是 **UTF-8 字节**，不是 JS 的 UTF-16 码元：中文一个字在 JS 里是 1 个码元、
 * 在文件里是 3 个字节，按码元算两边永远对不上。
 */
export function fnv1a32(text: string): number {
  const bytes = new TextEncoder().encode(text)
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

const store = (): Storage | null =>
  typeof localStorage === 'undefined' ? null : localStorage

const key = (id: string) => `quill:origin:${id}`

export function readOrigin(id: string): ChapterOrigin | null {
  const ls = store()
  if (!ls) return null
  try {
    const raw = ls.getItem(key(id))
    if (!raw) return null
    const o = JSON.parse(raw) as ChapterOrigin
    /*
     * 区间和摘要都得在。缺摘要就当没有来路 ——
     * 宁可不给合并入口，也不能拿着「不校验」的坐标去覆盖原书。
     */
    const ok =
      o &&
      o.srcId &&
      o.to > o.from &&
      typeof o.digest === 'number' &&
      o.digest !== 0
    return ok ? o : null
  } catch {
    return null
  }
}

export function writeOrigin(id: string, o: ChapterOrigin) {
  const ls = store()
  if (!ls || !(o.to > o.from) || !o.digest) return
  try {
    ls.setItem(key(id), JSON.stringify(o))
  } catch {
    // 存不下就算了：大不了这一篇不能合并，不影响它本身能改能存
  }
}

export function clearOrigin(id: string) {
  const ls = store()
  if (!ls) return
  try {
    ls.removeItem(key(id))
  } catch {
    // 同上
  }
}
