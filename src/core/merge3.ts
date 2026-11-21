/**
 * 三方合并（base / mine / disk），按行。
 *
 * 冲突处理的老三样（我的、磁盘的、接在文末）都不够聪明：大多数时候两边改的是
 * **不同的段落**，完全能自动合上。这里先把能合的都合掉，只把真正撞车的行段
 * 标成冲突，交给用户决定。
 *
 * 算法：分别求 base→mine、base→disk 的行级差异，得到各自修改的 base 区间；
 * 两边不相交就直接取那一边，相交就记为冲突。不做逐字符合并 —— 中文写作里
 * 行是最自然的单位，行内混排反而会拼出半句话。
 */

export interface MergeResult {
  /** 合并后的正文；有冲突且 `withMarkers` 时含 <<<<<<< / ======= / >>>>>>> */
  merged: string
  /** 冲突段数（0 表示可以全自动合） */
  conflicts: number
}

interface Change {
  /** base 里的区间 [start, end) */
  start: number
  end: number
  /** 用来替换的行 */
  lines: string[]
}

/** 行级 LCS，返回把 base 变成 other 的修改段 */
function changes(base: string[], other: string[]): Change[] {
  const n = base.length
  const m = other.length
  // 先裁掉公共前后缀：大文件下能省掉绝大部分 dp 表
  let head = 0
  while (head < n && head < m && base[head] === other[head]) head += 1
  let tail = 0
  while (tail < n - head && tail < m - head && base[n - 1 - tail] === other[m - 1 - tail]) tail += 1

  const a = base.slice(head, n - tail)
  const b = other.slice(head, m - tail)
  const A = a.length
  const B = b.length
  if (!A && !B) return []
  if (!A) return [{ start: head, end: head, lines: b }]
  if (!B) return [{ start: head, end: head + A, lines: [] }]

  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度
  const dp: number[][] = Array.from({ length: A + 1 }, () => new Array<number>(B + 1).fill(0))
  for (let i = A - 1; i >= 0; i -= 1) {
    for (let j = B - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const out: Change[] = []
  let i = 0
  let j = 0
  let i0 = -1
  let j0 = -1
  const flush = (iEnd: number, jEnd: number) => {
    if (i0 < 0) return
    out.push({ start: head + i0, end: head + iEnd, lines: b.slice(j0, jEnd) })
    i0 = -1
    j0 = -1
  }
  while (i < A && j < B) {
    if (a[i] === b[j]) {
      flush(i, j)
      i += 1
      j += 1
      continue
    }
    if (i0 < 0) {
      i0 = i
      j0 = j
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) i += 1
    else j += 1
  }
  // 收尾：剩下的都算这一段的修改
  if (i0 < 0) {
    i0 = i
    j0 = j
  }
  flush(A, B)
  return out
}

/**
 * 合并两个版本。
 *
 * `withMarkers`：冲突处写不写 `<<<<<<< 本地 / ======= / >>>>>>> 磁盘`。
 * 写（默认）= 给「先合进来再手工收拾」用；不写 = 预览时按本地优先。
 */
export function merge3(
  baseText: string,
  mineText: string,
  diskText: string,
  withMarkers = true,
): MergeResult {
  const base = baseText.split('\n')
  const mine = mineText.split('\n')
  const disk = diskText.split('\n')

  const mineChanges = changes(base, mine)
  const diskChanges = changes(base, disk)

  const out: string[] = []
  let cursor = 0
  let conflicts = 0
  let mi = 0
  let di = 0

  const pushBase = (until: number) => {
    while (cursor < until) {
      out.push(base[cursor])
      cursor += 1
    }
  }

  while (mi < mineChanges.length || di < diskChanges.length) {
    const m = mineChanges[mi]
    const d = diskChanges[di]
    const next = m && d ? (m.start <= d.start ? m : d) : (m ?? d)

    // 两边改到同一段（区间相交）→ 冲突
    if (m && d && m.start <= d.end && d.start <= m.end) {
      pushBase(m.start)
      if (withMarkers) {
        out.push('<<<<<<< 本地')
        out.push(...m.lines)
        out.push('=======')
        out.push(...d.lines)
        out.push('>>>>>>> 磁盘')
      } else {
        out.push(...m.lines)
      }
      conflicts += 1
      cursor = Math.max(m.end, d.end)
      mi += 1
      di += 1
      while (mi < mineChanges.length && mineChanges[mi].start < cursor) mi += 1
      while (di < diskChanges.length && diskChanges[di].start < cursor) di += 1
      continue
    }

    pushBase(next.start)
    out.push(...next.lines)
    cursor = Math.max(cursor, next.end)
    if (next === m) mi += 1
    else di += 1
  }
  pushBase(base.length)
  return { merged: out.join('\n'), conflicts }
}

/** 正文里还留着冲突标记吗（有的话不能直接当最终稿保存） */
export function hasMarkers(text: string): boolean {
  return /^<<<<<<< /m.test(text)
}
