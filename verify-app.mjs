// 验收 Tauri 窗口里的 Quill：连 WebView2 的 CDP，跑 DOM 断言 + 截图
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const CDP_PORT = process.env.CDP_PORT || 9222
const OUT_DIR = fileURLToPath(new URL('./.verify/', import.meta.url))
mkdirSync(OUT_DIR, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let ws
const logs = []

try {
  let page = null
  for (let i = 0; i < 80 && !page; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
      const list = await res.json()
      page =
        list.find((t) => t.type === 'page' && (t.url || '').includes('5173')) ??
        list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) ??
        null
    } catch {
      /* 还没起来 */
    }
    if (!page) await sleep(500)
  }
  if (!page) throw new Error(`CDP 端点未就绪（port ${CDP_PORT}）`)

  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = (e) => rej(new Error('WebSocket 连接失败: ' + String(e?.message ?? e)))
  })

  let msgId = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id !== undefined) {
      const p = pending.get(msg.id)
      if (p) {
        pending.delete(msg.id)
        p(msg)
      }
      return
    }
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      logs.push(`${msg.params.type}: ` + msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '))
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      logs.push('exception: ' + (msg.params.exceptionDetails?.exception?.description ?? 'unknown'))
    }
  })

  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = ++msgId
      pending.set(id, res)
      ws.send(JSON.stringify({ id, method, params }))
    })

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) {
      return { __error: r.result.exceptionDetails.exception?.description ?? 'eval error' }
    }
    return r.result?.result?.value
  }

  await send('Runtime.enable')
  await send('Page.enable')

  // 等应用就绪
  let ready = false
  for (let i = 0; i < 60; i++) {
    const n = await evaluate(`document.querySelectorAll('.doc-item').length`)
    if (typeof n === 'number' && n > 0) {
      ready = true
      break
    }
    await sleep(300)
  }
  await sleep(700)

  const result = await evaluate(`(async () => {
    const q = (s) => document.querySelector(s)
    const qa = (s) => [...document.querySelectorAll(s)]

    // 1) 折叠按钮是否注入
    const foldToggles = qa('.ProseMirror .fold-toggle').length

    // 2) 折叠是否真的隐藏了子列表
    const nestedBefore = qa('.ProseMirror ul ul li').filter(el => el.offsetParent !== null).length
    const toggle = q('.ProseMirror .fold-toggle')
    if (toggle) {
      toggle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    }
    await new Promise(r => setTimeout(r, 260))
    const foldedNodes = qa('.ProseMirror li.is-folded').length
    const nestedAfter = qa('.ProseMirror ul ul li').filter(el => el.offsetParent !== null).length
    // 展开回来
    const toggle2 = q('.ProseMirror .fold-toggle.folded')
    if (toggle2) toggle2.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await new Promise(r => setTimeout(r, 200))

    // 3) 专注模式开关
    const focusBtn = qa('.titlebar button').find(b => b.title === '专注模式')
    focusBtn?.click()
    await new Promise(r => setTimeout(r, 320))
    const focusOn = q('.ProseMirror')?.classList.contains('focus-mode') ?? false
    const dimmed = getComputedStyle(q('.ProseMirror > *') || document.body).opacity
    const toastCount = qa('.toast').length
    const toastText = q('.toast .t-text')?.textContent ?? null
    focusBtn?.click()
    await new Promise(r => setTimeout(r, 200))
    const focusOff = !(q('.ProseMirror')?.classList.contains('focus-mode') ?? true)

    // 4) 打字机开关
    const twBtn = qa('.titlebar button').find(b => b.title === '打字机模式')
    twBtn?.click()
    await new Promise(r => setTimeout(r, 220))
    const typewriter = q('.editor-scroll')?.classList.contains('typewriter') ?? false
    twBtn?.click()

    // 5) 搜索正文
    const input = q('.search input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '导图')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 900))
    const searchHits = qa('.doc-item').length
    const hitSub = qa('.doc-item .sub').map(e => e.textContent).slice(0, 2)
    setter.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))

    return {
      ready: true,
      foldToggles,
      nestedVisibleBefore: nestedBefore,
      foldedNodes,
      nestedVisibleAfter: nestedAfter,
      focusOn,
      focusOff,
      dimmedOpacity: dimmed,
      toastCount,
      toastText,
      typewriter,
      searchHits,
      hitSub,
      saveFlagClass: q('.save-flag')?.className ?? null,
      metaText: q('.doc-meta')?.innerText.replace(/\\n/g, ' | ') ?? null,
      sidebarClass: q('.sidebar')?.className ?? null,
      docCount: qa('.doc-item').length,
      animCount: qa('*').filter(el => {
        const s = getComputedStyle(el)
        return s.animationName && s.animationName !== 'none'
      }).length,
    }
  })()`)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const shotPath = join(OUT_DIR, 'app-features.png')
  writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'))

  console.log(JSON.stringify({ ready, result, logs, shot: shotPath }, null, 2))
} catch (err) {
  console.error('验收失败：', err?.message ?? err)
  console.error(JSON.stringify({ logs }, null, 2))
  process.exitCode = 1
} finally {
  try {
    ws?.close()
  } catch {}
}
