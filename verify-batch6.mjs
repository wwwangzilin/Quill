// 第六批验收：主窗口按钮 / 便签窗口 / 磁贴窗口 的 hash 路由
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.APP_URL || 'http://127.0.0.1:4178/'
const CDP_PORT = Number(process.env.CDP_PORT || 9339)
const OUT_DIR = fileURLToPath(new URL('./.verify/', import.meta.url))
mkdirSync(OUT_DIR, { recursive: true })

const profile = mkdtempSync(join(tmpdir(), 'quill-edge-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
const logs = []

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

  const visit = async (hash, waitSel, ms = 1400) => {
    // 先回空白页：同源只改 hash 时浏览器不会重新加载，初次路由判断就跑不到
    await send('Page.navigate', { url: 'about:blank' })
    await sleep(250)
    await send('Page.navigate', { url: BASE + hash })
    await sleep(ms)
    try {
      await evaluate(`void 0`)
    } catch {
      /* ignore */
    }
    return evaluate(`(() => {
      const q = (s) => document.querySelector(s)
      const qa = (s) => [...document.querySelectorAll(s)]
      return {
        sel: ${JSON.stringify(waitSel)},
        found: !!q(${JSON.stringify(waitSel)}),
        title: document.title,
        buttons: qa('.titlebar button').map(b => b.title).filter(Boolean),
        qnFound: !!q('.qn-root'),
        qnHasTextarea: !!q('.qn-input'),
        qnHint: q('.qn-hint')?.textContent ?? null,
        qnRecentTitle: q('.qn-recent-title')?.textContent ?? null,
        stickyFound: !!q('.sticky-root'),
        stickyTitle: q('.sticky-title')?.textContent ?? null,
        stickyBtns: qa('.sticky-btn').map(b => b.title),
        stickyBody: q('.sticky-body')?.textContent?.slice(0, 40) ?? null,
      }
    })()`)
  }

  // 1) 主窗口
  const main = await visit('', '.app')
  // 2) 便签窗口
  const quick = await visit('#quicknote', '.qn-root')
  // 3) 磁贴窗口
  const sticky = await visit('#sticky=' + encodeURIComponent('欢迎使用 Quill.md'), '.sticky-root')

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const shotPath = join(OUT_DIR, 'batch6-sticky.png')
  writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'))

  console.log(JSON.stringify({ main, quick, sticky, logs, shot: shotPath }, null, 2))
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
