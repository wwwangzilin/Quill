// 第二批功能验收：斜杠命令 / 模板菜单 / 快捷键面板 / 导图导出
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const APP_URL = process.env.APP_URL || 'http://localhost:5173/'
const CDP_PORT = Number(process.env.CDP_PORT || 9335)
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

    // ---- 1) 模板菜单 ----
    q('.sidebar .btn.primary')?.click()
    await nap(340)
    out.tplCount = qa('.tpl-menu .tpl').length
    out.tplNames = qa('.tpl-menu .tpl').map(e => e.textContent.replace(/\\s+/g,' ').trim()).slice(0, 6)
    out.tplAnimated = qa('.tpl-menu .tpl').every(el => {
      const s = getComputedStyle(el)
      return s.animationName !== 'none' || s.transitionDuration !== '0s'
    })
    q('.sidebar .btn.primary')?.click()
    await nap(220)
    out.tplClosed = qa('.tpl-menu').length === 0

    // ---- 2) 快捷键面板 ----
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true }))
    await nap(420)
    out.modalOpen = !!q('.modal')
    out.scGroups = qa('.sc-group').length
    out.scRows = qa('.sc-row').length
    out.modalAnimated = q('.modal') ? getComputedStyle(q('.modal')).animationName : null
    q('.modal-head .btn')?.click()
    await nap(300)
    out.modalClosed = !q('.modal')

    // ---- 3) 斜杠命令 ----
    const prose = q('.ProseMirror')
    prose.focus()
    prose.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }))
    document.execCommand('insertText', false, '/')
    await nap(420)
    out.slashOpen = !!q('.slash-menu')
    out.slashItems = qa('.slash-item').length
    out.slashPos = q('.slash-menu') ? { left: q('.slash-menu').style.left, top: q('.slash-menu').style.top } : null

    document.execCommand('insertText', false, '标题')
    await nap(380)
    out.slashFiltered = qa('.slash-item').length
    out.slashLabels = qa('.slash-item .label').map(e => e.textContent)

    prose.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await nap(300)
    out.slashClosed = !q('.slash-menu')

    // 清掉刚插入的 "/标题"
    const del = { key: 'Backspace' }
    for (let i = 0; i < 3; i++) {
      prose.dispatchEvent(new KeyboardEvent('keydown', del))
      const sel = window.getSelection()
      if (sel && sel.focusNode && sel.focusOffset > 0) {
        const r = document.createRange()
        r.setStart(sel.focusNode, Math.max(0, sel.focusOffset - 1))
        r.setEnd(sel.focusNode, sel.focusOffset)
        sel.removeAllRanges()
        sel.addRange(r)
        document.execCommand('delete')
      }
      await nap(60)
    }

    // ---- 4) 导图导出按钮 ----
    qa('.seg button').find(b => b.textContent.includes('导图'))?.click()
    await nap(800)
    out.mmTools = qa('.mm-tools .btn').map(e => e.textContent)
    out.mmNodes = qa('.mm-node').length
    out.mmDrawAnim = q('.mm-link') ? getComputedStyle(q('.mm-link')).animationName : null
    out.mmPathLength = q('.mm-link')?.getAttribute('pathLength') ?? null

    qa('.seg button').find(b => b.textContent.includes('写作'))?.click()
    await nap(400)

    return out
  })()`)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const shotPath = join(OUT_DIR, 'batch2-mindmap.png')
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
