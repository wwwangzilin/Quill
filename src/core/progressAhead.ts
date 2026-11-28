import type { DocPos } from './lastPos'

/** 只判断有明确章节顺序的阅读位置；时间戳更新不等于实际读得更远。 */
export function aheadBy(local: DocPos, remote: DocPos, chapterTitles: string[]): boolean {
  if (local.chapter && remote.chapter) {
    const localIndex = chapterTitles.indexOf(local.chapter)
    const remoteIndex = chapterTitles.indexOf(remote.chapter)
    if (localIndex < 0 || remoteIndex < 0) return false
    if (remoteIndex !== localIndex) return remoteIndex > localIndex
    return (remote.page ?? 0) - (local.page ?? 0) > 2
  }
  if (typeof local.ratio === 'number' && typeof remote.ratio === 'number') {
    return remote.ratio - local.ratio > 0.02
  }
  if (typeof local.scroll === 'number' && typeof remote.scroll === 'number') {
    return remote.scroll - local.scroll > 500
  }
  return false
}
