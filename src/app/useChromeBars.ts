import { useEffect, useState } from 'react'
import { readAutoHide } from '../core/chrome'
import type { ViewMode } from '../core/types'

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

  /*
   * 右栏：**鼠标靠近右边缘才打开**。
   *
   * 它是「边看边调」的外观设置，常驻会把正文挤窄，所以不进「鼠标一动就出」那一组。
   * 判据用坐标而不是元素 —— 无边框窗口最右边那几像素归系统的缩放边框管
   * （WM_NCHITTEST 直接吃掉，WebView 压根收不到事件），所以留 16px 余量。
   * 鼠标一旦进了右栏就留着（closest('.aside')），不会点着点着自己收走。
   */
  useEffect(() => {
    let leave = 0
    const onMove = (e: MouseEvent) => {
      const near = e.clientX >= window.innerWidth - 16
      const on =
        near || Boolean(document.elementFromPoint(e.clientX, e.clientY)?.closest('.aside'))
      if (on) {
        if (leave) {
          window.clearTimeout(leave)
          leave = 0
        }
        setAsidePeek(true)
        return
      }
      if (leave) return
      leave = window.setTimeout(() => {
        leave = 0
        setAsidePeek(false)
      }, 500)
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      if (leave) window.clearTimeout(leave)
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
