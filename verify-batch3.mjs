// 第三批验收：拖拽手柄 / 标签 / 回收站 / 热力图 / 导图跳转
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5173/'
const CDP_PORT = Number(process.env.CDP_PORT || 9336)
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
  await sleep(1000)

  const result = await evaluate(`(async () => {
    const q = (s) => document.querySelector(s)
    const qa = (s) => [...document.querySelectorAll(s)]
    const nap = (ms) => new Promise(r => setTimeout(r, ms))
    const out = {}

    // ---- 1) 拖拽手柄 ----
    out.dragHandles = qa('.ProseMirror .drag-handle').length
    out.dragHandleOpacityIdle = getComputedStyle(q('.drag-handle') || document.body).opacity

    // 真的试一次拖拽（合成 DragEvent + DataTransfer）
    const handles = qa('.ProseMirror .drag-handle')
    if (handles.length >= 2) {
      const src = handles[0]
      const dst = handles[1]
      const srcRect = src.getBoundingClientRect()
      const dstRect = dst.getBoundingClientRect()
      const dt = new DataTransfer()
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
      const prose = q('.ProseMirror')
      prose.dispatchEvent(new DragEvent('dragover', {
        bubbles: true, cancelable: true, dataTransfer: dt,
        clientX: dstRect.left + 30, clientY: dstRect.top + dstRect.height + 2,
      }))
      await nap(150)
      out.dragLineVisible = q('.drag-line') ? getComputedStyle(q('.drag-line')).display : null
      prose.dispatchEvent(new DragEvent('drop', {
        bubbles: true, cancelable: true, dataTransfer: dt,
        clientX: dstRect.left + 30, clientY: dstRect.top + dstRect.height + 2,
      }))
      await nap(300)
      out.dragNoCrash = true
      void srcRect
    }

    // ---- 2) 标签 ----
    out.tagInput = !!q('.tag-input')
    const input = q('.tag-input')
    if (input) {
      input.focus()
      input.value = '验收标签'
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await nap(700)
      out.tagChips = qa('.tag-editor .tag').map(e => e.textContent.replace('×','').trim())
    }

    // ---- 3) 热力图 ----
    out.heatCells = qa('.heat-cell').length
    out.heatCols = qa('.heat-col').length
    out.sideFoot = !!q('.side-foot')

    // ---- 4) 回收站 ----
    const trashBtn = qa('.side-foot button').find(b => b.title === '回收站')
    out.trashBtn = !!trashBtn
    trashBtn?.click()
    await nap(500)
    out.trashModal = !!q('.modal')
    out.trashModalTitle = q('.modal-head span')?.textContent.trim() ?? null
    q('.modal-head .btn')?.click()
    await nap(300)
    out.trashClosed = !q('.modal')

    // ---- 5) 导图节点跳转 ----
    qa('.seg button').find(b => b.textContent.includes('导图'))?.click()
    await nap(900)
    out.mmNodes = qa('.mm-node').length
    const target = qa('.mm-node')[1] || qa('.mm-node')[0]
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nap(800)
    out.backToWrite = !!q('.ProseMirror')
    const sel = window.getSelection()
    out.selectionText = sel ? sel.toString().slice(0, 24) : null

    return out
  })()`)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const shotPath = join(OUT_DIR, 'batch3.png')
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
