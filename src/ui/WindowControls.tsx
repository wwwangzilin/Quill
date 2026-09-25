import { useEffect, useState } from 'react'
import {
  closeWindow,
  minimizeWindow,
  toggleMaximizeWindow,
  watchMaximize,
} from '../core/frame'
import { isTauri } from '../core/windows'

/**
 * 无边框窗口右上角的三个按钮（最小化 / 最大化 / 关闭）。
 *
 * 系统标题栏被去掉之后，这里是窗口唯一的出口。但它们不照着 Windows 原生
 * 画 —— 直角方框加一块大红，跟这个界面不是一路的。所以走圆角细线：
 * 图形收在 10×10 里只占中间一小块，线条圆头，交给 CSS 决定颜色。
 */
export default function WindowControls() {
  const [maxed, setMaxed] = useState(false)

  // watchMaximize 自己会先读一次当前状态，这里不用再补一发
  useEffect(() => watchMaximize(setMaxed), [])

  // 纯网页里没有窗口可管（顶栏照常渲染，只是少了系统装饰）
  if (!isTauri()) return null

  return (
    <div className="win-ctl">
      <button
        className="win-btn"
        onClick={() => void minimizeWindow()}
        title="最小化"
        aria-label="最小化"
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.2 5h5.6" />
        </svg>
      </button>

      <button
        className="win-btn"
        onClick={() => void toggleMaximizeWindow()}
        title={maxed ? '向下还原' : '最大化'}
        aria-label={maxed ? '向下还原' : '最大化'}
      >
        {maxed ? (
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <rect x="1.9" y="3.3" width="4.8" height="4.8" rx="1.2" />
            <path d="M3.4 3.3V2h4.7v4.7H6.7" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <rect x="2.2" y="2.2" width="5.6" height="5.6" rx="1.4" />
          </svg>
        )}
      </button>

      <button
        className="win-btn close"
        onClick={() => void closeWindow()}
        title="关闭"
        aria-label="关闭"
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.7 2.7l4.6 4.6M7.3 2.7L2.7 7.3" />
        </svg>
      </button>
    </div>
  )
}
