/**
 * 阅读速度与剩余时间估算。
 *
 * 速度不是写死的：每翻一页，用「这一页的字数 ÷ 在这一页停了多久」更新一个滑动平均，
 * 存在本机。快速扫过（太快）和挂机（太久）的页不算，免得把速度带偏。
 * 全是纯函数，时间和数字由参数传入。
 */

/** 没有任何数据时的默认速度：中文网文一般 300~500 字/分钟 */
export const DEFAULT_CPM = 400
const MIN_CPM = 120
const MAX_CPM = 1200
/** 一页停留不到这么久，当作快速翻过，不计入 */
const MIN_MS = 1500
/** 一页停留超过这么久，当作走神 / 挂机，不计入 */
const MAX_MS = 150_000
/** 单页算出来超过这个速度，也当作扫读，不计入 */
const SKIM_CPM = 1500

export function clampCpm(v: number): number {
  return Math.max(MIN_CPM, Math.min(MAX_CPM, v))
}

/** 用刚读完的一页更新速度（字/分钟）；不可信的样本原样返回旧值 */
export function updateCpm(prev: number, chars: number, ms: number): number {
  if (!(chars > 0) || ms < MIN_MS || ms > MAX_MS) return prev
  const inst = chars / (ms / 60_000)
  if (inst > SKIM_CPM) return prev
  return clampCpm(prev * 0.8 + inst * 0.2)
}

/**
 * 还剩多少字。chapterChars 是各章字数，ci 是当前章，frac 是这一章读到的比例（0~1）。
 * 返回 [本章剩余, 全书剩余]。
 */
export function remaining(chapterChars: number[], ci: number, frac: number): [number, number] {
  const cur = chapterChars[ci] ?? 0
  const left = Math.max(0, cur * (1 - Math.max(0, Math.min(1, frac))))
  let rest = 0
  for (let i = ci + 1; i < chapterChars.length; i += 1) rest += chapterChars[i]
  return [Math.round(left), Math.round(left + rest)]
}

export function minutesFor(chars: number, cpm: number): number {
  return cpm > 0 ? chars / cpm : 0
}

export function fmtEta(min: number): string {
  if (min < 1) return '不到 1 分钟'
  if (min < 60) return `${Math.round(min)} 分钟`
  const h = Math.floor(min / 60)
  const m = Math.round(min - h * 60)
  if (m === 60) return `${h + 1} 小时`
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`
}

const KEY = 'quill-set:read-cpm'

/** 是否已经积累过个人阅读速度；没有样本时目录不显示估算。 */
export function hasStoredCpm(): boolean {
  try {
    const raw = localStorage.getItem(KEY)
    const value = Number(raw)
    return raw !== null && Number.isFinite(value) && value > 0
  } catch {
    return false
  }
}
// quill-reading-features:stored-cpm-check
export function loadCpm(): number {
  try {
    const v = Number(localStorage.getItem(KEY))
    return v > 0 ? clampCpm(v) : DEFAULT_CPM
  } catch {
    return DEFAULT_CPM
  }
}
export function saveCpm(v: number): void {
  try {
    localStorage.setItem(KEY, String(Math.round(v)))
  } catch {
    /* 记不住就算了 */
  }
}
