/**
 * 批注复习：把高亮 / 批注当闪卡，按「记得 / 模糊 / 忘了」安排下次出现的时间（SM-2 简化版）。
 * 状态存 localStorage（和阅读位置一样，是这台机器上这个人的进度），纯函数部分可在 node 下测。
 */
export type Grade = 'good' | 'hazy' | 'again'

export interface CardState {
  /** 下次到期时间（ms） */
  due: number
  /** 间隔天数 */
  ivl: number
  /** 难度系数，1.3 ~ 3 */
  ease: number
  /** 连续答对次数 */
  reps: number
}

const DAY = 86400000
export const NEW_CARD: CardState = { due: 0, ivl: 0, ease: 2.5, reps: 0 }

export function schedule(s: CardState | undefined, grade: Grade, now = Date.now()): CardState {
  const c = s ?? NEW_CARD
  if (grade === 'again') {
    // 忘了：10 分钟后再来一次，难度系数降一点
    return { due: now + 10 * 60000, ivl: 0, ease: Math.max(1.3, c.ease - 0.2), reps: 0 }
  }
  const reps = c.reps + 1
  let ivl: number
  if (grade === 'hazy') {
    ivl = c.reps === 0 ? 1 : Math.max(1, Math.round(c.ivl * 1.2))
  } else if (reps === 1) ivl = 1
  else if (reps === 2) ivl = 3
  else ivl = Math.round(c.ivl * c.ease)
  const ease = grade === 'good' ? Math.min(3, c.ease + 0.05) : Math.max(1.3, c.ease - 0.1)
  return { due: now + ivl * DAY, ivl, ease, reps }
}

/** 今天该复习的：没复习过的 + 到期的；到期最久的排前面，新卡最后 */
export function dueList<T extends { id: string }>(items: T[], states: Record<string, CardState>, now = Date.now()): T[] {
  const due: { it: T; t: number }[] = []
  const fresh: T[] = []
  for (const it of items) {
    const s = states[it.id]
    if (!s) fresh.push(it)
    else if (s.due <= now) due.push({ it, t: s.due })
  }
  due.sort((a, b) => a.t - b.t)
  return [...due.map((d) => d.it), ...fresh]
}

/** 下次出现的人话，给按钮提示用 */
export function ivlLabel(s: CardState): string {
  if (s.ivl <= 0) return '10 分钟后'
  return s.ivl === 1 ? '明天' : `${s.ivl} 天后`
}

const keyOf = (docId: string) => `quill-set:review:${docId}`

export function readReview(docId: string): Record<string, CardState> {
  try {
    const j = JSON.parse(localStorage.getItem(keyOf(docId)) ?? '{}')
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
}

export function writeReview(docId: string, m: Record<string, CardState>): void {
  try {
    localStorage.setItem(keyOf(docId), JSON.stringify(m))
  } catch {
    /* 记不住复习进度不该打扰阅读 */
  }
}

/** 跨文档复习用的卡片：除了批注本身，还得知道它属于哪篇 */
export interface XCard<C extends { id: string }> {
  docId: string
  docTitle: string
  c: C
}

/**
 * 把多篇文档的批注合成一个队列：到期最久的在前，新卡在后；
 * 同一个队列里每篇文档的新卡轮流出（不然第一篇一百条新卡会把别的书全挤到后面）。
 */
export function dueAcross<C extends { id: string }>(
  docs: { docId: string; docTitle: string; comments: C[] }[],
  statesOf: (docId: string) => Record<string, CardState>,
  now = Date.now(),
): XCard<C>[] {
  const due: { card: XCard<C>; t: number }[] = []
  const fresh: XCard<C>[][] = []
  for (const d of docs) {
    const st = statesOf(d.docId)
    const f: XCard<C>[] = []
    for (const c of d.comments) {
      const s = st[c.id]
      const card = { docId: d.docId, docTitle: d.docTitle, c }
      if (!s) f.push(card)
      else if (s.due <= now) due.push({ card, t: s.due })
    }
    if (f.length) fresh.push(f)
  }
  due.sort((a, b) => a.t - b.t)
  const mixed: XCard<C>[] = []
  for (let i = 0; fresh.some((f) => i < f.length); i += 1) for (const f of fresh) if (i < f.length) mixed.push(f[i])
  return [...due.map((d) => d.card), ...mixed]
}
