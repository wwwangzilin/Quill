/**
 * 鼠标跟随聚光：卡片被悬停时，表面有一团柔光跟着鼠标走（样式见 styles/36-texture.css）。
 *
 * 只做一件事 —— 把指针在卡片内的坐标写成 --mx / --my 两个 CSS 变量；
 * 光怎么画、什么颜色，全在样式里。一个全局监听、rAF 合并，不给每张卡片单挂事件，
 * 列表有几百条也不会多出几百个监听器。
 */

/** 哪些元素要聚光。新增卡片类，往这里加一个选择器、再去 36-texture.css 里给它开 ::after */
const TARGETS = '.doc-item, .theme-card, .list-row, .wiki-card, .settings-nav-item'

export function initSpotlight(): void {
  if (typeof document === 'undefined') return
  let raf = 0
  let pending: { el: HTMLElement; x: number; y: number } | null = null

  document.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') return
      const el = (e.target as Element | null)?.closest?.(TARGETS) as HTMLElement | null
      if (!el) return
      pending = { el, x: e.clientX, y: e.clientY }
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const p = pending
        pending = null
        if (!p) return
        const r = p.el.getBoundingClientRect()
        p.el.style.setProperty('--mx', `${Math.round(p.x - r.left)}px`)
        p.el.style.setProperty('--my', `${Math.round(p.y - r.top)}px`)
      })
    },
    { passive: true },
  )
}
