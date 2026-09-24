import { createRoot } from 'react-dom/client'
import App from './App'
import QuickNote from './windows/QuickNote'
import Sticky from './windows/Sticky'
import { applyAppearance } from './core/fonts'
import { initTheme } from './core/theme'
import { windowRole } from './core/windows'
import './style.css'

// 这个窗口是什么身份、走到哪一步了 —— 出问题时在调试器里一眼能看出来
const boot: string[] = []
;(window as unknown as Record<string, unknown>).__quillBoot = boot
window.addEventListener('error', (e) => boot.push('ERROR ' + (e.message || String(e.error))))
window.addEventListener('unhandledrejection', (e) => boot.push('REJECT ' + String(e.reason)))

boot.push('boot ' + location.href)
// 三种窗口都要先穿上主题。主窗口自己还会管切换，但便签与磁贴没有那段代码，
// 漏掉这一步它们就跟着系统偏好走，和主窗口手动选的主题对不上。
initTheme()
applyAppearance()

// 同一份前端产物，靠窗口 label 分成三种窗口：
//   主窗口 / quicknote（快捷便签）/ sticky-<文档名十六进制>（桌面磁贴）
// 不用 StrictMode：它会双次挂载，Tiptap 编辑器实例在双挂载下行为容易出怪
//
// 子窗口挂载成功后会调 markWindowReady 报到；
// 要是 10 秒还没报到，Rust 侧的看门狗会直接把窗口关掉，不留白板。
const root = createRoot(document.getElementById('root')!)
const role = windowRole()
boot.push('role ' + JSON.stringify(role))

try {
  if (role.kind === 'quicknote') {
    root.render(<QuickNote />)
  } else if (role.kind === 'sticky') {
    root.render(<Sticky doc={role.doc} />)
  } else {
    root.render(<App />)
  }
  boot.push('rendered')
} catch (err) {
  boot.push('RENDER FAIL ' + String(err))
}
