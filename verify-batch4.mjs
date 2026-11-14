// 第四批验收：查找替换 / 设置面板 / 双向链接
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4178/'
const CDP_PORT = Number(process.env.CDP_PORT || 9337)
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

    // ---- 1) 设置面板 ----
    const gear = qa('.titlebar button').find(b => b.title === '备份与设置')
    out.gearBtn = !!gear
    gear?.click()
    await nap(500)
    out.settingsOpen = !!q('.modal')
    out.settingsTitle = q('.modal-head span')?.textContent.trim() ?? null
    out.fields = qa('.modal .field > span').map(e => e.textContent.trim())
    out.hasReveal = qa('.modal .btn').some(b => b.textContent.includes('资源管理器'))
    q('.modal-head .btn')?.click()
    await nap(300)
    out.settingsClosed = !q('.modal')

    // ---- 2) 查找替换 ----
    const prose = q('.ProseMirror')
    prose.focus()
    prose.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }))
    await nap(400)
    out.findBar = !!q('.find-bar')
    const findInput = q('.find-input')
    if (findInput) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(findInput, 'Quill')
      findInput.dispatchEvent(new Event('input', { bubbles: true }))
      await nap(500)
      out.hitCount = qa('.ProseMirror .search-hit').length
      out.activeHits = qa('.ProseMirror .search-hit.active').length
      out.countLabel = q('.find-count')?.textContent ?? null
      setter.call(findInput, '')
      findInput.dispatchEvent(new Event('input', { bubbles: true }))
      await nap(200)
    }
    q('.find-bar .btn.ghost.icon[title]')?.click()
    await nap(250)
    out.findClosed = !q('.find-bar')

    // ---- 3) 双向链接：[[ 补全 ----
    prose.focus()
    document.execCommand('insertText', false, '[[')
    await nap(500)
    const menu = q('.slash-menu')
    out.wikiMenu = !!menu
    out.wikiHead = q('.slash-menu .slash-head')?.textContent.trim() ?? null
    out.wikiItems = qa('.slash-menu .slash-item').length

    // 选第一项插入
    q('.slash-menu .slash-item')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await nap(500)
    out.wikiLinks = qa('.ProseMirror .wikilink').length
    out.wikiTarget = q('.ProseMirror .wikilink')?.getAttribute('data-target') ?? null
    out.menuClosed = !q('.slash-menu')

    return out
  })()`)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const shotPath = join(OUT_DIR, 'batch4.png')
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
