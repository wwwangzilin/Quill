// 第五批验收：拖拽（pointer）/ 右侧标记 / 媒体菜单 / 新配色
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4178/'
const CDP_PORT = Number(process.env.CDP_PORT || 9338)
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

  for (let i = 0; i < 60; i++) {
    const n = await evaluate(`document.querySelectorAll('.doc-item').length`)
    if (typeof n === 'number' && n > 0) break
    await sleep(300)
  }
  await sleep(900)

  const result = await evaluate(`(async () => {
    const q = (s) => document.querySelector(s)
    const qa = (s) => [...document.querySelectorAll(s)]
    const nap = (ms) => new Promise(r => setTimeout(r, ms))
    const out = {}

    // ---- 配色 ----
    const cs = getComputedStyle(document.documentElement)
    out.accent1 = cs.getPropertyValue('--accent-1').trim()
    out.bg = cs.getPropertyValue('--bg').trim()
    out.text = cs.getPropertyValue('--text').trim()
    out.grad = cs.getPropertyValue('--grad').trim().slice(0, 60)

    // ---- 右侧块类型标记 ----
    const labels = qa('.ProseMirror .gutter-label').map(e => e.textContent)
    out.gutterCount = labels.length
    out.gutterSet = [...new Set(labels)]
    const first = q('.ProseMirror .gutter-label')
    if (first) {
      const r = first.getBoundingClientRect()
      const p = first.parentElement.getBoundingClientRect()
      out.gutterSide = r.left > p.left + p.width / 2 ? 'right' : 'left'
      out.gutterOpacity = getComputedStyle(first).opacity
    }

    // ---- 拖拽手柄结构 ----
    const handle = q('.ProseMirror .drag-handle')
    out.handleDots = handle ? handle.querySelectorAll('i').length : 0
    out.handleDraggable = handle ? handle.getAttribute('draggable') : null
    out.handleTouchAction = handle ? getComputedStyle(handle).touchAction : null

    // ---- 拖拽：模拟 pointerdown → pointermove → 看落点线 ----
    if (handle) {
      const hr = handle.getBoundingClientRect()
      handle.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, clientX: hr.x + 6, clientY: hr.y + 6, pointerId: 1,
      }))
      await nap(80)
      out.handleClassesAfterDown = handle.className
      out.bodyDragging = document.body.classList.contains('quill-dragging')

      const blocks = qa('.ProseMirror > *')
      const target = blocks[Math.min(2, blocks.length - 1)]
      const tr = target.getBoundingClientRect()
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, clientX: tr.left + 40, clientY: tr.bottom - 2, pointerId: 1,
      }))
      await nap(120)
      const line = q('.drag-line')
      out.lineVisible = line ? getComputedStyle(line).display : null
      out.lineTop = line ? line.style.top : null

      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
      await nap(150)
      out.dragEndedClean = !document.body.classList.contains('quill-dragging')
      out.lineHidden = line ? getComputedStyle(line).display === 'none' : true
    }

    // ---- 斜杠菜单里的媒体项 ----
    const prose = q('.ProseMirror')
    prose.focus()
    prose.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }))
    document.execCommand('insertText', false, '/')
    await nap(450)
    out.slashCount = qa('.slash-item').length
    out.slashLabels = qa('.slash-item .label').map(e => e.textContent)
    prose.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await nap(200)
    // 清掉 '/'
    document.execCommand('delete')

    return out
  })()`)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const shotPath = join(OUT_DIR, 'batch5.png')
  writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'))

  console.log(JSON.stringify({ result, logs, shot: shotPath }, null, 2))
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
