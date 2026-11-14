// 第四批功能验收：命令面板 / 反向链接 / AI 全文问答 / AI 选中改写
// 自带假的 OpenAI 兼容服务（SSE），不需要真 Key；跑完还原现场。
import { createServer } from 'node:http'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

const CDP_PORT = Number(process.env.CDP_PORT || 9222)
const MOCK_PORT = Number(process.env.AI_MOCK_PORT || 8792)
const MARK = 'AI-MOCK-OUT'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ok = {}
const detail = {}

/* ---------------- 假模型服务 ---------------- */
const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url.includes('/chat/completions')) {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let parsed = {}
      try {
        parsed = JSON.parse(body || '{}')
      } catch {
        /* 忽略 */
      }
      const user = String(parsed.messages?.[1]?.content ?? '')
      detail.calls = (detail.calls ?? 0) + 1
      detail.lastPromptHead = user.slice(0, 60)
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      res.flushHeaders()
      const chars = [...MARK]
      let i = 0
      const timer = setInterval(() => {
        if (i >= chars.length) {
          clearInterval(timer)
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chars[i++] } }] })}\n\n`)
      }, 18)
      res.on('close', () => clearInterval(timer))
    })
    return
  }
  res.writeHead(404)
  res.end('not found')
})
await new Promise((r) => server.listen(MOCK_PORT, '127.0.0.1', r))
console.log(`· 假模型服务已起：http://127.0.0.1:${MOCK_PORT}/v1`)

/* ---------------- CDP ---------------- */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    let msgId = 0
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id !== undefined) {
        const p = pending.get(msg.id)
        if (p) {
          pending.delete(msg.id)
          p(msg)
        }
      }
    }
    ws.onopen = () =>
      resolve({
        close: () => ws.close(),
        fire: (m, p = {}) => ws.send(JSON.stringify({ id: ++msgId, method: m, params: p })),
        send: (m, p = {}) =>
          new Promise((res) => {
            const id = ++msgId
            pending.set(id, res)
            ws.send(JSON.stringify({ id, method: m, params: p }))
          }),
      })
    ws.onerror = (e) => reject(new Error(String(e?.message ?? e)))
  })
}
async function evalIn(c, expression, ms = 10000) {
  const r = await Promise.race([
    c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
    sleep(ms).then(() => ({ __timeout: true })),
  ])
  if (r.__timeout) return { __timeout: true }
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description }
  return r.result?.result?.value
}
async function clickAt(c, x, y) {
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(220)
}
async function centerOf(c, expr, nth = 0) {
  const raw = await evalIn(
    c,
    `(()=>{const els=${expr}; const e=els[${nth}]; if(!e) return 'null'; const r=e.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`,
  )
  return raw === 'null' || typeof raw !== 'string' ? null : JSON.parse(raw)
}
async function pressKey(c, key, code, vk, mods = 0, text = '') {
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods }
  await c.send('Input.dispatchKeyEvent', { ...base, type: 'keyDown', text, unmodifiedText: text })
  await c.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' })
  await sleep(260)
}
async function typeText(c, text) {
  for (const ch of text) {
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch })
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await sleep(16)
  }
}

const list = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).filter(
  (t) => t.type === 'page',
)
const main = list.find((t) => t.title === 'Quill') ?? list[0]
const c = await connect(main.webSocketDebuggerUrl)
await c.send('Runtime.enable')

/** 文档纯文本以编辑器 state 为准 */
await c.send('Runtime.evaluate', {
  expression: `window.docPlain = () => window.__quillEditor?.state.doc.textContent ?? ''`,
})

try {
  for (let i = 0; i < 40; i++) {
    const n = await evalIn(c, `document.querySelectorAll('.doc-item').length`)
    if (typeof n === 'number' && n > 0) break
    await sleep(500)
  }

  /* ================= ① 命令面板 ================= */
  await pressKey(c, 'p', 'KeyP', 80, 2 /* Ctrl */)
  await sleep(350)
  ok.paletteOpens = await evalIn(c, `!!document.querySelector('.palette')`)

  // 搜命令：输入「主题」
  await typeText(c, '主题')
  await sleep(300)
  detail.paletteCmdRows = await evalIn(
    c,
    `JSON.stringify([...document.querySelectorAll('.palette-row .palette-title')].map(e => e.textContent).slice(0, 4))`,
  )
  ok.paletteFindsCommand = String(detail.paletteCmdRows).includes('主题')

  // 搜文档：清空后输入当前文档标题的第一个字
  const curTitle = await evalIn(c, `document.querySelector('.doc-title')?.value ?? ''`)
  detail.currentTitle = curTitle
  for (let i = 0; i < 6; i++) await pressKey(c, 'Backspace', 'Backspace', 8)
  await typeText(c, String(curTitle).slice(0, 2))
  await sleep(320)
  detail.paletteDocRows = await evalIn(
    c,
    `JSON.stringify([...document.querySelectorAll('.palette-row')].map(e => e.textContent).slice(0, 4))`,
  )
  ok.paletteFindsDoc = String(detail.paletteDocRows).includes(String(curTitle).slice(0, 2))

  // Enter 执行第一条
  await pressKey(c, 'Enter', 'Enter', 13)
  await sleep(500)
  ok.paletteClosesOnRun = await evalIn(c, `!document.querySelector('.palette')`)

  /* ================= ② AI 全文问答 ================= */
  detail.saveAi = await evalIn(
    c,
    `window.__TAURI_INTERNALS__.invoke('ai_save', {
       baseUrl: 'http://127.0.0.1:${MOCK_PORT}/v1', model: 'mock', apiKey: 'sk-test'
     }).then(s => JSON.stringify(s)).catch(e => 'ERR ' + e)`,
  )

  await pressKey(c, 'a', 'KeyA', 65, 2 | 8 /* Ctrl+Shift */)
  await sleep(400)
  ok.chatOpens = await evalIn(c, `!!document.querySelector('.aichat')`)

  const chip = await centerOf(c, `[...document.querySelectorAll('.aichat-chip')]`, 0)
  if (chip) await clickAt(c, chip.x, chip.y)

  let chatText = null
  for (let i = 0; i < 40; i++) {
    chatText = await evalIn(c, `document.querySelector('.aichat-answer')?.textContent ?? null`)
    if (chatText && chatText.includes(MARK)) break
    await sleep(280)
  }
  detail.chatAnswer = chatText
  ok.chatStreams = Boolean(chatText && chatText.includes(MARK))
  detail.chatPromptHead = detail.lastPromptHead

  // 关掉面板
  await evalIn(c, `document.querySelector('.aichat-head button')?.click()`)
  await sleep(300)
  ok.chatCloses = await evalIn(c, `!document.querySelector('.aichat')`)

  /* ================= ③ AI 选中改写 ================= */
  // 选中最后一个文本节点里的一小段（先滚进视口，不然浮条坐标在屏幕外，点不到）
  detail.selected = await evalIn(
    c,
    `(()=>{
      const ed = window.__quillEditor
      let hit = null
      ed.state.doc.descendants((node, pos) => {
        if (node.isText && node.text.trim().length >= 4) hit = { pos, len: node.text.length }
      })
      if (!hit) return 'no-text'
      ed.commands.setTextSelection({ from: hit.pos, to: hit.pos + Math.min(hit.len, 10) })
      ed.commands.scrollIntoView()
      return ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to)
    })()`,
  )
  await sleep(600)
  ok.selBarAppears = await evalIn(c, `!!document.querySelector('.ai-sel')`)
  detail.selButtons = await evalIn(
    c,
    `JSON.stringify([...document.querySelectorAll('.ai-sel-btn')].map(e => e.textContent))`,
  )
  detail.selRect = await evalIn(
    c,
    `(()=>{const e=document.querySelector('.ai-sel'); if(!e) return 'null'; const r=e.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),inView: r.top>=0 && r.bottom<=window.innerHeight})})()`,
  )

  const polish = await centerOf(c, `[...document.querySelectorAll('.ai-sel-btn')]`, 0)
  if (polish) await clickAt(c, polish.x, polish.y)

  let rewrite = null
  for (let i = 0; i < 40; i++) {
    rewrite = await evalIn(c, `document.querySelector('.ai-sel-body')?.textContent ?? null`)
    if (rewrite && rewrite.includes(MARK)) break
    await sleep(280)
  }
  detail.rewrite = rewrite
  ok.rewriteStreams = Boolean(rewrite && rewrite.includes(MARK))

  // 采纳 → 文档里应该出现改写结果
  const before = await evalIn(c, `docPlain()`)
  const accept = await centerOf(c, `[...document.querySelectorAll('.ai-sel-foot button')]`, 0)
  if (accept) await clickAt(c, accept.x, accept.y)
  await sleep(500)
  const after = await evalIn(c, `docPlain()`)
  detail.accept = { changed: before !== after, hasMark: String(after).includes(MARK) }
  ok.rewriteAccepted = before !== after && String(after).includes(MARK)

  // 撤销，别把测试文本留在文档里
  await evalIn(c, `window.__quillEditor.commands.undo()`)
  await sleep(300)
  detail.afterUndo = (await evalIn(c, `docPlain()`)).includes(MARK) === false

  /* ================= ④ 反向链接 ================= */
  // 记下当前文档标题，然后去「另一篇」文档里加上 [[当前文档]] 的引用
  const hostTitle = String(await evalIn(c, `document.querySelector('.doc-title')?.value ?? ''`))
  detail.hostTitle = hostTitle
  const otherIdx = await evalIn(
    c,
    `(()=>{
       const items=[...document.querySelectorAll('.doc-item')]
       const i = items.findIndex(e => !e.textContent.includes(${JSON.stringify(hostTitle)}))
       return String(i)
     })()`,
  )
  detail.otherIdx = otherIdx
  const other = await centerOf(c, `[...document.querySelectorAll('.doc-item')]`, Number(otherIdx))
  if (other) await clickAt(c, other.x, other.y)
  await sleep(800)
  detail.switchedTo = await evalIn(c, `document.querySelector('.doc-title')?.value ?? ''`)
  ok.switchedAway = String(detail.switchedTo) !== hostTitle

  // 在末尾敲一行引用
  await evalIn(c, `window.__quillEditor.commands.focus('end')`)
  await sleep(250)
  await typeText(c, `[[${hostTitle}]]`)
  detail.typedRef = await evalIn(c, `JSON.stringify(docPlain().slice(-30))`)
  await sleep(1100) // 等自动保存（650ms 防抖 + git 提交）

  // 回原文档
  const back = await evalIn(
    c,
    `(()=>{
       const items=[...document.querySelectorAll('.doc-item')]
       const i=items.findIndex(e => e.textContent.includes(${JSON.stringify(hostTitle)}))
       return String(i)
     })()`,
  )
  const backBtn = await centerOf(c, `[...document.querySelectorAll('.doc-item')]`, Number(back))
  if (backBtn) await clickAt(c, backBtn.x, backBtn.y)
  await sleep(800)

  // 展开反向链接
  const head = await centerOf(c, `[...document.querySelectorAll('.backlinks-head')]`, 0)
  if (head) await clickAt(c, head.x, head.y)
  let hits = 0
  for (let i = 0; i < 25; i++) {
    hits = Number(await evalIn(c, `document.querySelectorAll('.backlink').length`))
    if (hits > 0) break
    await sleep(300)
  }
  detail.backlinkCount = hits
  detail.backlinkText = await evalIn(
    c,
    `JSON.stringify([...document.querySelectorAll('.backlink .backlink-title')].map(e => e.textContent))`,
  )
  ok.backlinkFound = hits > 0

  /* ================= 清理 ================= */
  // 回到那篇测试文档，撤掉刚敲的引用
  const cleanIdx = Number(otherIdx)
  const cleanBtn = await centerOf(c, `[...document.querySelectorAll('.doc-item')]`, cleanIdx)
  if (cleanBtn) await clickAt(c, cleanBtn.x, cleanBtn.y)
  await sleep(700)
  await evalIn(c, `window.__quillEditor.commands.undo()`)
  await sleep(900)
  detail.cleaned = !(await evalIn(c, `docPlain()`)).includes(`[[${hostTitle}]]`)
  ok.cleanedUp = detail.cleaned === true
} catch (err) {
  detail.error = String(err?.message ?? err)
  console.log('! 出错:', detail.error)
} finally {
  try {
    rmSync(join(process.env.APPDATA ?? '', 'com.quill.write', 'ai.json'), { force: true })
  } catch {
    /* 没有就算了 */
  }
  c.close()
  server.close()
}

console.log('\n=== 结论 ===')
console.log(JSON.stringify({ ok, failed: Object.entries(ok).filter(([, v]) => !v).map(([k]) => k) }, null, 2))
console.log('\n=== 细节 ===')
console.log(JSON.stringify(detail, null, 2))
process.exit(0)
