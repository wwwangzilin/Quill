/**
 * 「回到刚才的位置」：跳转（搜索、目录、进度条、书签）之前先记下原位置，
 * 之后角落里给一个浮条，点一下就回去。翻一两页、读下一章这类正常阅读不算跳转。
 */
export interface Spot {
  ci: number
  page: number
}

/** 离开原位置够远才值得记：跨了不止一章，或同章里页码差了 3 页以上 */
export function isBigJump(from: Spot, to: Spot): boolean {
  if (from.ci !== to.ci) return Math.abs(from.ci - to.ci) > 1
  return Math.abs(from.page - to.page) > 2
}
