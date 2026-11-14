// 多窗口验收：磁贴 / 便签 能不能开出来、渲染出内容、并且关得掉
// 所有窗口都加载同一个 URL，所以只能用「窗口 label」来认人，不能靠 URL/title
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const CDP_PORT = Number(process.env.CDP_PORT || 9222)
const OUT_DIR = fileURLToPath(new URL('./.verify/', import.meta.url))
mkdirSync(OUT_DIR, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pages = async () =>
  (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).filter(
    (t) => t.type === 'page' && t.webSocketDebuggerUrl,
  )

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    const events = []
    let msgId = 0
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id !== undefined) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p(msg)
        }
      } else events.push(msg)
    }
    ws.onopen = () =>
      resolve({
        events,
        close: () => ws.close(),
        fire: (method, params = {}) => ws.send(JSON.stringify({ id: ++msgId, method, params })),
        send: (method, params = {}) =>
          new Promise((res) => {
            const id = ++msgId
            pending.set(id, res)
            ws.send(JSON.stringify({ id, method, params }))
          }),
      })
    ws.onerror = (e) => reject(new Error(String(e?.message ?? e)))
  })
}

async function sendTimed(conn, method, params, ms = 8000) {
  return Promise.race([conn.send(method, params), sleep(ms).then(() => ({ __timeout: method }))])
}

async function evalIn(conn, expression, ms = 8000) {
  const r = await sendTimed(conn, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, ms)
  if (r.__timeout) return { __timeout: true }
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description }
  return r.result?.result?.value
}

const LABEL_EXPR = `(()=>{try{return window.__TAURI_INTERNALS__.metadata.currentWindow.label}catch(e){return null}})()`
const PROBE = `JSON.stringify({
  label: (()=>{try{return window.__TAURI_INTERNALS__.metadata.currentWindow.label}catch(e){return null}})(),
  boot: window.__quillBoot ?? null,
  hasSticky: !!document.querySelector('.sticky-root'),
  hasNote: !!document.querySelector('.qn-root'),
  heading: document.querySelector('.sticky-title')?.textContent ?? null,
  noteInput: !!document.querySelector('.qn-input'),
  bodyHead: (document.querySelector('.sticky-body')?.textContent ?? '').slice(0, 40),
  buttons: [...document.querySelectorAll('.sticky-btn, .qn-x')].map(b => b.title),
  bodyBg: getComputedStyle(document.body).backgroundColor,
})`

/** 打开所有 target，读回它们的 label，建立 label -> target 映射 */
async function labeled() {
  const list = await pages()
  const out = []
  for (const t of list) {
    const c = await connect(t.webSocketDebuggerUrl)
    await c.send('Runtime.enable')
    const label = await evalIn(c, LABEL_EXPR, 5000)
    out.push({ label, target: t, conn: c })
  }
  return out
}

const report = { ok: {}, steps: [] }
const log = (s) => {
  report.steps.push(s)
  console.log('·', s)
}

let conns = []
try {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await pages()).length) break
    } catch {
      /* 等 */
    }
    await sleep(600)
  }

  conns = await labeled()
  const main = conns.find((c) => c.label === 'main')
  if (!main) throw new Error('没找到主窗口（label=main）')
  for (let i = 0; i < 30; i++) {
    const n = await evalIn(main.conn, `document.querySelectorAll('.doc-item').length`)
    if (typeof n === 'number' && n > 0) break
    await sleep(500)
  }
  log('主窗口就绪: ' + (await evalIn(main.conn, PROBE)).slice(0, 120))

  // ---------- 磁贴 ----------
  main.conn.fire('Runtime.evaluate', {
    expression: `window.__TAURI_INTERNALS__.invoke('open_sticky', {doc:'收件箱.md', title:'收件箱'}).catch(e=>console.error('open_sticky', e))`,
  })
  await sleep(4000)
  conns = await labeled()
  const sticky = conns.find((c) => String(c.label).startsWith('sticky-'))
  report.ok.stickyOpened = Boolean(sticky)
  if (sticky) {
    report.sticky = await evalIn(sticky.conn, PROBE)
    log('磁贴: ' + String(report.sticky))
    const shot = await sendTimed(sticky.conn, 'Page.captureScreenshot', { format: 'png' }, 9000)
    if (shot?.result?.data) {
      report.shot = join(OUT_DIR, 'sticky-window.png')
      writeFileSync(report.shot, Buffer.from(shot.result.data, 'base64'))
      log('已截图: ' + report.shot)
    }
    // 点 × 关掉
    sticky.conn.fire('Runtime.evaluate', { expression: `document.querySelector('.sticky-btn[title="取消磁贴"]')?.click()` })
    await sleep(3000)
    const after = await labeled()
    report.ok.stickyClosed = !after.some((c) => String(c.label).startsWith('sticky-'))
    log('磁贴关得掉吗: ' + (report.ok.stickyClosed ? '✓ 已关闭' : '✗ 还在'))
    for (const c of after) c.conn.close()
    conns = after
  }

  // ---------- 便签 ----------
  const main2 = conns.find((c) => c.label === 'main')
  main2.conn.fire('Runtime.evaluate', {
    expression: `window.__TAURI_INTERNALS__.invoke('open_quicknote').catch(e=>console.error('open_quicknote', e))`,
  })
  await sleep(4000)
  const afterNote = await labeled()
  const note = afterNote.find((c) => c.label === 'quicknote')
  report.ok.noteOpened = Boolean(note)
  if (note) {
    report.note = await evalIn(note.conn, PROBE)
    log('便签: ' + String(report.note))
    note.conn.fire('Runtime.evaluate', { expression: `document.querySelector('.qn-x')?.click()` })
    await sleep(3000)
    const left = await labeled()
    report.ok.noteClosed = !left.some((c) => c.label === 'quicknote')
    log('便签关得掉吗: ' + (report.ok.noteClosed ? '✓ 已关闭' : '✗ 还在'))
    for (const c of left) c.conn.close()
  } else {
    log('便签窗口没出现；当前 label: ' + JSON.stringify(afterNote.map((c) => c.label)))
  }
} catch (err) {
  report.error = String(err?.message ?? err)
  console.log('! 出错:', report.error)
}

console.log('\n===== 结论 =====')
console.log(JSON.stringify({ ok: report.ok, error: report.error ?? null }, null, 2))
process.exit(0)
