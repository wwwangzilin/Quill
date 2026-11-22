/**
 * 翻页的纯规则：动画种类、速度档、点按分区。
 * 不碰 React / DOM，所以能在 node 里直接测。
 */

export type PageTurn = 'slide' | 'fade' | 'flip' | 'none'

export const PAGE_TURNS: { id: PageTurn; name: string }[] = [
  { id: 'slide', name: '滑动' },
  { id: 'fade', name: '淡入' },
  { id: 'flip', name: '翻页' },
  { id: 'none', name: '无' },
]

export type TurnSpeed = 'slow' | 'normal' | 'fast'
export const TURN_SPEEDS: { id: TurnSpeed; name: string; scale: number }[] = [
  { id: 'slow', name: '慢', scale: 1.6 },
  { id: 'normal', name: '标准', scale: 1 },
  { id: 'fast', name: '快', scale: 0.6 },
]

/**
 * 点按分区：
 *  standard 左 22% 上一页 / 右 22% 下一页
 *  right    右手：右侧 45% 下一页（拇指够得着的地方），左 22% 上一页
 *  left     左手：左侧 45% 下一页，右 22% 上一页
 *  both     两侧都是下一页
 *  off      不用点按翻页
 * 余下的中间区域一律是「沉浸」开关。
 */
export type TapLayout = 'standard' | 'right' | 'left' | 'both' | 'off'
export const TAP_LAYOUTS: { id: TapLayout; name: string }[] = [
  { id: 'standard', name: '标准' },
  { id: 'right', name: '右手' },
  { id: 'left', name: '左手' },
  { id: 'both', name: '都下一页' },
  { id: 'off', name: '关' },
]

/** 点在 x（0~1，页面内的横向位置）上该干什么 */
export function tapAction(x: number, layout: TapLayout): 'prev' | 'next' | 'toggle' {
  switch (layout) {
    case 'off':
      return 'toggle'
    case 'both':
      return x < 0.22 || x > 0.78 ? 'next' : 'toggle'
    case 'right':
      return x < 0.22 ? 'prev' : x > 0.55 ? 'next' : 'toggle'
    case 'left':
      return x > 0.78 ? 'prev' : x < 0.45 ? 'next' : 'toggle'
    default:
      return x < 0.22 ? 'prev' : x > 0.78 ? 'next' : 'toggle'
  }
}

