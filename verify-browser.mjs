// 浏览器验收：CDP 驱动无头 Edge —— 抓控制台错误、等应用就绪、DOM 断言、精确截图
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4178/'
const CDP_PORT = 9333
const OUT_DIR = fileURLToPath(new URL('./.verify/', import.meta.url))
const PREFIX = process.env.SHOT_PREFIX || 'shot'
const THEME = process.env.APP_THEME || 'dark'

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
  // ---- 连接 CDP ----
  let page = null
  for (let i = 0; i < 80 && !page; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
      const list = await res.json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) ?? null
    } catch {
      /* 还没起来 */
    }
    if (!page) await sleep(250)
  }
  if (!page) throw new Error('CDP 端点未就绪')

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
      logs.push(
        `${msg.params.type}: ` +
          msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '),
      )
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      logs.push('exception: ' + (msg.params.exceptionDetails?.exception?.description ?? 'unknown'))
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      logs.push('log: ' + msg.params.entry.text)
    }
  })

  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = ++msgId
      pending.set(id, res)
      ws.send(JSON.stringify({ id, method, params }))
    })

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.result?.exceptionDetails) {
      return { __error: r.result.exceptionDetails.exception?.description ?? 'eval error' }
    }
    return r.result?.result?.value
  }

  await send('Runtime.enable')
  await send('Log.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })

  if (THEME === 'light') {
    // 主题在 localStorage 里，先落一个值再进页面
    await send('Page.navigate', { url: APP_URL })
    await sleep(1200)
    await evaluate(`localStorage.setItem('quill-theme','light')`)
  }

  await send('Page.navigate', { url: APP_URL })

  // ---- 等应用就绪（IndexedDB 灌完 → 列表出现） ----
  let ready = false
  for (let i = 0; i < 60; i++) {
    const n = await evaluate(`document.querySelectorAll('.doc-item').length`)
    if (typeof n === 'number' && n > 0) {
      ready = true
      break
    }
    await sleep(250)
  }

  await sleep(600) // 让编辑器首帧排版稳定

  const snapshot = await evaluate(`(() => {
    const q = (s) => document.querySelector(s)
    const qa = (s) => [...document.querySelectorAll(s)]
    const prose = q('.ProseMirror')
    const cs = (el, prop) => el ? getComputedStyle(el)[prop] : null
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
    return {
      theme: document.documentElement.dataset.theme,
      docItems: qa('.doc-item .t').map(e => e.textContent.trim()),
      activeItem: q('.doc-item.active .t')?.textContent.trim() ?? null,
      titleValue: q('.doc-title')?.value ?? null,
      titleFontSize: cs(q('.doc-title'), 'fontSize'),
      proseChars: prose ? prose.innerText.replace(/\\s/g,'').length : 0,
      proseFontSize: cs(prose, 'fontSize'),
      proseLineHeight: cs(prose, 'lineHeight'),
      headings: qa('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3').map(e => e.tagName + ':' + e.textContent.trim().slice(0,20)),
      topLevelItems: qa('.ProseMirror > ul > li').length,
      nestedItems: qa('.ProseMirror ul ul li').length,
      taskItems: qa('.ProseMirror ul[data-type="taskList"] li').length,
      checkedTasks: qa('.ProseMirror ul[data-type="taskList"] li[data-checked="true"]').length,
      blockquote: qa('.ProseMirror blockquote').length,
      metaText: q('.doc-meta')?.innerText.replace(/\\n/g,' | ') ?? null,
      editorRect: rect(q('.editor-inner')),
      sidebarRect: rect(q('.sidebar')),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyBg: cs(document.body, 'backgroundColor'),
      accentSample: cs(q('.btn.primary'), 'backgroundImage')?.slice(0, 60) ?? null,
    }
  })()`)

  // ---- 互动：切到导图，看 SVG 生成了什么 ----
  await evaluate(`[...document.querySelectorAll('.seg button')].find(b => b.textContent.includes('导图'))?.click()`)
  await sleep(900)
  const mindmap = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('.mm-node')]
    const links = [...document.querySelectorAll('.mm-link')]
    const first = nodes[0]?.querySelector('text')?.textContent ?? null
    const all = nodes.map(n => n.querySelector('text')?.textContent)
    const rect = document.querySelector('.mindmap svg')?.getBoundingClientRect()
    return {
      nodeCount: nodes.length,
      linkCount: links.length,
      rootText: first,
      labels: all.slice(0, 10),
      svgSize: rect ? { w: Math.round(rect.width), h: Math.round(rect.height) } : null,
      hint: document.querySelector('.mm-hint')?.textContent.trim() ?? null,
    }
  })()`)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const shotPath = join(OUT_DIR, `${PREFIX}-mindmap.png`)
  writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'))

  // 切回写作页再截一张
  await evaluate(`[...document.querySelectorAll('.seg button')].find(b => b.textContent.includes('写作'))?.click()`)
  await sleep(700)
  const shot2 = await send('Page.captureScreenshot', { format: 'png' })
  const shotPath2 = join(OUT_DIR, `${PREFIX}-write.png`)
  writeFileSync(shotPath2, Buffer.from(shot2.result.data, 'base64'))

  console.log(JSON.stringify({ ready, snapshot, mindmap, logs, shots: [shotPath, shotPath2] }, null, 2))
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
