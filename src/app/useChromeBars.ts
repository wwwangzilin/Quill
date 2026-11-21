import { useEffect, useState } from 'react'
import { readAutoHide } from '../core/chrome'
import type { ViewMode } from '../core/types'

/** 离右边缘多少像素算「靠近」—— 比滚动条宽一点，留出可用的触发带 */
const PEEK_EDGE = 24
/** 在边缘停多久才算「想打开」。抓滚动条通常是到边就按，比这个短 */
const PEEK_DWELL = 320

/**
 * 指针是不是压在某个滚动条的轨道上。
 *
 * 浏览器不直接给这个信息，只能自己推：找到指针底下最近的可滚动元素，
 * 它的 `offsetWidth - clientWidth` 就是竖直滚动条的宽度，
 * 指针落在右边缘这么宽的一条里，就是在滚动条上。
 */
function overScrollbar(x: number, y: number): boolean {
  let node = document.elementFromPoint(x, y) as HTMLElement | null
  while (node && node !== document.body) {
    if (node.scrollHeight > node.clientHeight + 1) {
      const rect = node.getBoundingClientRect()
      const bar = node.offsetWidth - node.clientWidth
      if (bar > 0 && x >= rect.right - bar) return true
      return false
    }
    node = node.parentElement
  }
  return false
}

/**
 * 上 / 下 / 左三个栏「写作时自动收起、鼠标一动就回来」，以及右栏「鼠标靠近才打开」。
 *
 * 只管这几个栏的显隐状态与监听；谁来渲染它们仍在 App。
 */
export function useChromeBars(opts: {
  view: ViewMode
  reading: boolean
  zen: boolean
  hasDoc: boolean
}) {
  const { view, reading, zen, hasDoc } = opts

  /**
   * 打字时把**上、下、左**三个栏一起收起来，鼠标一动就都回来（让位给正文）。
   * 右栏不在这组里 —— 它走「鼠标靠近才打开」，见下面的 asidePeek。
   */
  const [autoHide, setAutoHide] = useState(readAutoHide)
  const [barsHidden, setBarsHidden] = useState(false)
  /** 右栏：鼠标靠近右边缘临时唤出 —— 看一眼就够，不改 🎛 的开关状态 */
  const [asidePeek, setAsidePeek] = useState(false)

  /** 只在写作视图、且不在阅读/禅模式下才自动收 —— 那几个模式自己管界面 */
  const canAutoHide = autoHide && view === 'write' && !reading && !zen && hasDoc

  /*
   * 四周这四个栏，规则只有两条（主人定的）：
   *
   *   · 上 / 下 / 左 —— 鼠标一动就展开，**写作时自动收起**。三个栏共用
   *     `barsHidden` 一个状态：一敲字全收（让位给正文），鼠标一动全回来。
   *     `canAutoHide` 限定「只在写作视图、且不在阅读/禅模式」—— 别的视图
   *     本来就不写作，没必要收。
   *   · 右栏 —— **鼠标靠近才打开**（贴右边缘，见下面的 asidePeek）。
   *     它是「边看边调」的外观设置，常驻会把正文挤窄。
   *
   * 早先顶栏走的是另一套（够到上沿才滑出来），结果鼠标往上挪它才下来、
   * 按钮跟着往下跑，追不上 —— 主人报了七八遍。现在没有特例，四个栏两条规则。
   */
  /**
   * 鼠标够到状态栏上就把它钉住。
   *
   * 状态栏里有个「正文栏宽度」滑块，而这条栏是会自己收起/滑出的 ——
   * 手伸过去的时候它正滑着，滑块跟着动，根本点不中（主人原话「它会动点不到」）。
   * 钉住之后：鼠标在它上面时既不收、也不重播过渡，位置是死的。
   */
  const [barsPinned, setBarsPinned] = useState(false)
  useEffect(() => {
    if (!canAutoHide) {
      setBarsPinned(false)
      return
    }
    const onMove = (e: MouseEvent) => {
      const hit = document.elementFromPoint(e.clientX, e.clientY)
      setBarsPinned(Boolean(hit?.closest('.statusbar')))
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [canAutoHide])

  // 在正文里敲字就把顶栏底栏收起来。
  // 只排除两件事：带修饰键的快捷键、以及在真正的输入框里打字。
  // 这里**不**判断「焦点是不是在编辑器里」—— 中文输入法组词时那个判断不稳定，
  // 会把「打中文」这一整条路漏掉（表现就是打英文能收、打中文不收）。
  useEffect(() => {
    if (!canAutoHide) setBarsHidden(false)
    if (!canAutoHide) return

    const hide = () => {
      // 鼠标正搭在状态栏上就不收 —— 那儿有可拖的滑块，收走等于把东西从手里抽掉
      if (!barsPinned) setBarsHidden(true)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      hide()
    }
    window.addEventListener('keydown', onKey)
    // 输入法的第一枪是 compositionstart：Windows 上那一下常常没有可用的 keydown，
    // 所以单独听一次，中文才收得起来。
    window.addEventListener('compositionstart', hide)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('compositionstart', hide)
    }
  }, [canAutoHide, barsPinned])

  /**
   * 右栏：**鼠标在右边缘停一下才打开**。
   *
   * 这里以前是「一进右边 16px 就展开」，和编辑区那条滚动条打架：
   * 想去拖滚动条 = 把鼠标推到最右边 = 右栏展开 → 正文变窄、滚动条被挤到左边，
   * 手还停在原处，结果拖了个空。展开的是同一块区域，谁先谁后都别扭。
   *
   * 现在的规则（三条一起用）：
   *   1. **悬停意图**：在边缘停够 `PEEK_DWELL` 才展开。抓滚动条是「到边就按」，
   *      按下去之后就不再触发（见第 2 条），不会误开。
   *   2. **不抢滚动条**：指针落在任何滚动条的轨道上时，一律不改状态；
   *      按住鼠标拖动期间也一律不改状态 —— 拖滚动条时布局不能跳。
   *   3. **已经在栏里/正在滚**：保持展开，不启动收起计时；只有真的移开才收。
   */
  useEffect(() => {
    let leave = 0
    let dwell = 0
    const cancelLeave = () => {
      if (leave) {
        window.clearTimeout(leave)
        leave = 0
      }
    }
    const cancelDwell = () => {
      if (dwell) {
        window.clearTimeout(dwell)
        dwell = 0
      }
    }
    const onMove = (e: MouseEvent) => {
      // 按住鼠标 = 正在拖滚动条/选文字：这时候改布局，等于把人手里的东西抽走
      if (e.buttons !== 0) return
      const hit = document.elementFromPoint(e.clientX, e.clientY)
      if (hit?.closest('.aside')) {
        cancelDwell()
        cancelLeave()
        setAsidePeek(true)
        return
      }
      if (overScrollbar(e.clientX, e.clientY)) {
        // 指针在滚动条上：不展开、也不收起 —— 就是「别动」
        cancelDwell()
        cancelLeave()
        return
      }
      const near = e.clientX >= window.innerWidth - PEEK_EDGE
      if (near) {
        cancelLeave()
        if (!dwell) {
          dwell = window.setTimeout(() => {
            dwell = 0
            setAsidePeek(true)
          }, PEEK_DWELL)
        }
        return
      }
      cancelDwell()
      if (leave) return
      leave = window.setTimeout(() => {
        leave = 0
        setAsidePeek(false)
      }, 500)
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      cancelLeave()
      cancelDwell()
    }
  }, [])

  // 鼠标一动就放回来。收起之后留 400ms 冷静期 ——
  // 否则手搭在鼠标上轻微一抖，界面就自己弹回去了。
  useEffect(() => {
    if (!canAutoHide || !barsHidden) return
    let armed = false
    const timer = window.setTimeout(() => {
      armed = true
    }, 400)
    const wake = () => {
      if (armed) setBarsHidden(false)
    }
    window.addEventListener('mousemove', wake)
    window.addEventListener('mousedown', wake)
    window.addEventListener('wheel', wake, { passive: true })
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('mousedown', wake)
      window.removeEventListener('wheel', wake)
    }
  }, [canAutoHide, barsHidden])

  return { autoHide, setAutoHide, barsHidden, barsPinned, asidePeek, canAutoHide }
}
