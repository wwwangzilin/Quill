import { createRoot } from 'react-dom/client'
import App from './App'
import './style.css'

// 不用 StrictMode：它会双次挂载，Tiptap 的编辑器实例在双挂载下行为容易出怪
createRoot(document.getElementById('root')!).render(<App />)
