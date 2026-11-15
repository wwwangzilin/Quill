/**
 * 逐行比对 —— 冲突框靠它说清「到底哪几行不一样」。
 *
 * 放在 core 而不是 UI 里，是因为它没有 React 依赖、可以单独跑测试：
 * 对比逻辑写错了，用户看到的就是「明明只改了一句，却整篇标红」，
 * 那比不给对比还糟。
 */

export type DiffRow = { kind: 'same' | 'mine' | 'disk' | 'cut'; text: string }

/** 超过这么多行就不做逐行比对了 —— 800 万字的稿子算 LCS 会把界面卡死 */
const DIFF_CELL_LIMIT = 4_000_000
/** 每个差异前后保留几行上下文 */
const CONTEXT = 3

/**
 * 逐行 LCS：只为标出「哪几行不一样」，不求最短编辑距离的学术正确。
 * 超长文档退化成「我的全部 + 磁盘全部」—— 比对结果不如能打开重要。
 */
export function lineDiff(mine: string, disk: string): DiffRow[] {
  const a = mine.split('\n')
  const b = disk.split('\n')
  if (a.length * b.length > DIFF_CELL_LIMIT) {
    return [
      ...a.map((text) => ({ kind: 'mine' as const, text })),
      ...b.map((text) => ({ kind: 'disk' as const, text })),
    ]
  }

  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ kind: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: 'mine', text: a[i] })
      i++
    } else {
      rows.push({ kind: 'disk', text: b[j] })
      j++
    }
  }
  while (i < n) rows.push({ kind: 'mine', text: a[i++] })
  while (j < m) rows.push({ kind: 'disk', text: b[j++] })

  // 没有一处不同（理论上弹窗不该出现在这种时候）：原样返回，别折叠成一句废话
  if (rows.every((r) => r.kind === 'same')) return rows

  // 折叠长段未变内容：全量贴出来只会把真正的差异淹掉
  const keep = new Array<boolean>(rows.length).fill(false)
  for (let k = 0; k < rows.length; k++) {
    if (rows[k].kind === 'same') continue
    for (let d = -CONTEXT; d <= CONTEXT; d++) {
      const at = k + d
      if (at >= 0 && at < rows.length) keep[at] = true
    }
  }

  const out: DiffRow[] = []
  let cut = 0
  for (let k = 0; k < rows.length; k++) {
    if (!keep[k]) {
      cut++
      continue
    }
    if (cut > 0) {
      out.push({ kind: 'cut', text: `… ${cut} 行未变 …` })
      cut = 0
    }
    out.push(rows[k])
  }
  if (cut > 0) out.push({ kind: 'cut', text: `… ${cut} 行未变 …` })
  return out
}
