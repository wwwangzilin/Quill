import { createRoot } from 'react-dom/client'
import App from './App'
import QuickNote from './windows/QuickNote'
import Sticky from './windows/Sticky'
import { stickyDocOf } from './core/windows'
import './style.css'

// 同一份前端产物，靠 hash 分成三种窗口：
//   主窗口 / #quicknote（快捷便签）/ #sticky=<文档名>（桌面磁贴）
// 不用 StrictMode：它会双次挂载，Tiptap 编辑器实例在双挂载下行为容易出怪
const root = createRoot(document.getElementById('root')!)
const stickyDoc = stickyDocOf()

if (window.location.hash.startsWith('#quicknote')) {
  root.render(<QuickNote />)
} else if (stickyDoc) {
  root.render(<Sticky doc={stickyDoc} />)
} else {
  root.render(<App />)
}
