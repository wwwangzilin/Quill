// 新功能验收：折叠 / 专注 / 打字机 / Toast / 正文搜索 / 动效
// 直接跑在 vite dev server 上（无头 Edge + CDP）
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5173/'
const CDP_PORT = Number(process.env.CDP_PORT || 9334)
const OUT_DIR = fileURLToPath(new URL('./.verify/', import.meta.url))
mkdirSync(OUT_DIR, { recursive: true })

const profile = mkdtempSync(join(tmpdir(), 'quill-edge-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const logs = []

const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--disable-extensions',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let ws
try {
  let page = null
  for (let i = 0; i < 80 && !page; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
      const list = await res.json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) ?? null
    } catch {
      /* 等 */
    }
    if (!page) await sleep(250)
  }
  if (!page) throw new Error('CDP 端点未就绪')

  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = (e) => rej(new Error(String(e?.message ?? e)))
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
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await send('Page.navigate', { url: APP_URL })

  let ready = false
  for (let i = 0; i < 60; i++) {
    const n = await evaluate(`document.querySelectorAll('.doc-item').length`)
    if (typeof n === 'number' && n > 0) {
      ready = true
      break
    }
    await sleep(300)
  }
  await sleep(900)

  const result = await evaluate(`(async () => {
    const q = (s) => document.querySelector(s)
    const qa = (s) => [...document.querySelectorAll(s)]

    const foldToggles = qa('.ProseMirror .fold-toggle').length
    const nestedBefore = qa('.ProseMirror ul ul li').filter(el => el.offsetParent !== null).length
    q('.ProseMirror .fold-toggle')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await new Promise(r => setTimeout(r, 300))
    const foldedNodes = qa('.ProseMirror li.is-folded').length
    const nestedAfter = qa('.ProseMirror ul ul li').filter(el => el.offsetParent !== null).length
    q('.ProseMirror .fold-toggle.folded')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await new Promise(r => setTimeout(r, 250))
    const nestedRestored = qa('.ProseMirror ul ul li').filter(el => el.offsetParent !== null).length

    const focusBtn = qa('.titlebar button').find(b => b.title === '专注模式')
    focusBtn?.click()
    await new Promise(r => setTimeout(r, 400))
    const focusOn = q('.ProseMirror')?.classList.contains('focus-mode') ?? false
    const firstBlockOpacity = getComputedStyle(q('.ProseMirror > *') || document.body).opacity
    const focusedCount = qa('.ProseMirror > .is-focus').length
    const toastCount = qa('.toast').length
    const toastText = q('.toast .t-text')?.textContent ?? null
    focusBtn?.click()
    await new Promise(r => setTimeout(r, 250))
    const focusOff = !(q('.ProseMirror')?.classList.contains('focus-mode') ?? true)

    const twBtn = qa('.titlebar button').find(b => b.title === '打字机模式')
    twBtn?.click()
    await new Promise(r => setTimeout(r, 250))
    const typewriter = q('.editor-scroll')?.classList.contains('typewriter') ?? false
    twBtn?.click()

    const input = q('.search input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '导图')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 1100))
    const searchHitCount = qa('.doc-item').length
    const hitSubs = qa('.doc-item .sub').map(e => e.textContent).slice(0, 2)
    setter.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))

    // 侧栏 collapse 动画（改为常驻 + hidden class）
    qa('.titlebar button').find(b => b.title?.includes('侧栏'))?.click()
    await new Promise(r => setTimeout(r, 400))
    const sidebarHidden = q('.sidebar')?.classList.contains('hidden') ?? false
    const sidebarOpacity = getComputedStyle(q('.sidebar')).opacity
    qa('.titlebar button').find(b => b.title?.includes('侧栏'))?.click()
    await new Promise(r => setTimeout(r, 400))
    const sidebarBack = !(q('.sidebar')?.classList.contains('hidden') ?? true)

    let animated = 0
    for (const el of qa('body *')) {
      const s = getComputedStyle(el)
      if (s.animationName && s.animationName !== 'none') animated += 1
    }

    return {
      foldToggles, nestedVisibleBefore: nestedBefore, foldedNodes,
      nestedVisibleAfter: nestedAfter, nestedRestored,
      focusOn, focusOff, focusedCount, firstBlockOpacity,
      toastCount, toastText, typewriter,
      searchHitCount, hitSubs,
      sidebarHidden, sidebarOpacity, sidebarBack,
      animatedElements: animated,
      metaText: q('.doc-meta')?.innerText.replace(/\\n/g, ' · ') ?? null,
      saveFlagClass: q('.save-flag')?.className ?? null,
    }
  })()`)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const shotPath = join(OUT_DIR, 'feature-batch.png')
  writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'))

  // 折叠态截图
  await evaluate(`document.querySelector('.ProseMirror .fold-toggle')?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}))`)
  await sleep(500)
  const shot2 = await send('Page.captureScreenshot', { format: 'png' })
  const shotPath2 = join(OUT_DIR, 'feature-folded.png')
  writeFileSync(shotPath2, Buffer.from(shot2.result.data, 'base64'))

  console.log(JSON.stringify({ ready, result, logs, shots: [shotPath, shotPath2] }, null, 2))
} catch (err) {
  console.error('验收失败：', err?.message ?? err)
  console.error(JSON.stringify({ logs }, null, 2))
  process.exitCode = 1
} finally {
  try {
    ws?.close()
  } catch {}
  child.kill()
}
