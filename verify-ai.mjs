// AI 续写端到端验收：
//   起一个假的 OpenAI 兼容服务（SSE 流式）→ 把 Quill 的 AI 配置指过去
//   → 在编辑器里真敲字 → 等幽灵文本出现 → Tab 接受 / Esc 忽略
// 不依赖真的 API Key，跑完会把测试用的配置清干净。
import { createServer } from 'node:http'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

const CDP_PORT = Number(process.env.CDP_PORT || 9222)
const MOCK_PORT = Number(process.env.AI_MOCK_PORT || 8791)
const REPLY = 'mock-completion-text'
const TYPED = 'Today I want to write about '

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
      detail.lastRequest = {
        model: parsed.model,
        stream: parsed.stream,
        maxTokens: parsed.max_tokens,
        temperature: parsed.temperature,
        systemHead: String(parsed.messages?.[0]?.content ?? '').slice(0, 24),
        userHasTyped: String(parsed.messages?.[1]?.content ?? '').includes(TYPED.trim()),
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.flushHeaders()
      const chars = [...REPLY]
      let i = 0
      const timer = setInterval(() => {
        if (i >= chars.length) {
          clearInterval(timer)
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chars[i++] } }] })}\n\n`)
      }, 20)
      // 注意：要盯 res 的 close（客户端断开），不能用 req.on('close') ——
      // 后者在「请求体读完」时就会触发，定时器会被立刻清掉，一个字都发不出去
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
  await sleep(200)
}

async function centerOf(c, expr, nth = 0) {
  const raw = await evalIn(
    c,
    `(()=>{const els=${expr}; const e=els[${nth}]; if(!e) return 'null'; const r=e.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`,
  )
  return raw === 'null' || typeof raw !== 'string' ? null : JSON.parse(raw)
}

/** 逐字符敲键盘（走真实按键路径，不触发输入法组词态） */
async function typeText(c, text) {
  for (const ch of text) {
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch })
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await sleep(18)
  }
}

async function pressKey(c, key, code, vk, text = '') {
  await c.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
    text,
    unmodifiedText: text,
  })
  await c.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  })
  await sleep(300)
}

const list = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).filter(
  (t) => t.type === 'page',
)
const main = list.find((t) => t.title === 'Quill') ?? list[0]
const c = await connect(main.webSocketDebuggerUrl)
await c.send('Runtime.enable')

// 「文档里到底有什么」以编辑器 state 为准 —— 幽灵文本只是 DOM 装饰，
// 用 .ProseMirror 的 textContent 判断会把它一起算进去
await c.send('Runtime.evaluate', {
  expression: `window.docPlain = () => window.__quillEditor?.state.doc.textContent ?? ''`,
})
// 从文档里彻底删掉某段测试文本（结束时要还原现场）
// 注意：按「纯文本偏移 → 文档位置」的映射删，不能按单个文本节点匹配，
// 那段文本很可能被拆到好几个节点里
await c.send('Runtime.evaluate', {
  expression: `window.cleanNeedle = (needle) => {
    const ed = window.__quillEditor
    if (!ed) return 'no-editor'
    let removed = 0
    for (let guard = 0; guard < 6; guard++) {
      const { state } = ed
      const posAt = []
      let text = ''
      state.doc.descendants((node, pos) => {
        if (!node.isText) return
        for (let i = 0; i < node.text.length; i++) { posAt.push(pos + i); text += node.text[i] }
      })
      const idx = text.indexOf(needle)
      if (idx < 0) break
      ed.view.dispatch(state.tr.delete(posAt[idx], posAt[idx + needle.length - 1] + 1))
      removed += 1
    }
    return JSON.stringify({ removed, stillThere: ed.state.doc.textContent.includes(needle) })
  }`,
})
await c.send('Runtime.evaluate', {
  expression: `window.countNeedle = (needle) => {
    const t = window.__quillEditor?.state.doc.textContent ?? ''
    return t.split(needle).length - 1
  }`,
})

try {
  /* 1. 等应用就绪并进入写作视图 */
  for (let i = 0; i < 40; i++) {
    const n = await evalIn(c, `document.querySelectorAll('.doc-item').length`)
    if (typeof n === 'number' && n > 0) break
    await sleep(500)
  }
  const docRect = await centerOf(c, `[...document.querySelectorAll('.doc-item')]`, 0)
  if (docRect) await clickAt(c, docRect.x, docRect.y)
  await sleep(800)
  ok.editorReady = await evalIn(c, `!!document.querySelector('.ProseMirror')`)

  /* 2. 把 AI 配置指向假服务（走真实命令，不碰文件） */
  detail.saveAi = await evalIn(
    c,
    `window.__TAURI_INTERNALS__.invoke('ai_save', {
       baseUrl: 'http://127.0.0.1:${MOCK_PORT}/v1', model: 'mock-model', apiKey: 'sk-test-key'
     }).then(s => JSON.stringify(s)).catch(e => 'ERR ' + e)`,
  )

  /* 3. 用界面把开关打开（顺带验 UI 通） */
  const more = await centerOf(c, `[...document.querySelectorAll('.titlebar button')].filter(b => b.textContent.trim() === '⋯')`)
  await clickAt(c, more.x, more.y)
  await sleep(300)
  await evalIn(c, `[...document.querySelectorAll('.menu.more .mi')].find(x => x.textContent.includes('备份与设置')).click()`)
  await sleep(600)
  const checkRect = await evalIn(
    c,
    `(()=>{const el=document.querySelector('.modal input[type=checkbox]'); if(!el) return 'null'; el.scrollIntoView({block:'center'}); return 'ok'})()`,
  )
  await sleep(400)
  const box = await centerOf(c, `[...document.querySelectorAll('.modal input[type=checkbox]')]`)
  if (box) await clickAt(c, box.x, box.y)
  await sleep(250)
  let checked = await evalIn(c, `document.querySelector('.modal input[type=checkbox]')?.checked === true`)
  if (checked !== true && box) {
    // 再点一次：万一第一次被滚动动画带偏了
    await clickAt(c, box.x, box.y)
    await sleep(250)
    checked = await evalIn(c, `document.querySelector('.modal input[type=checkbox]')?.checked === true`)
  }
  detail.checkboxHit = checkRect
  ok.toggleOn = checked === true
  // 顺手点一下「保存 AI 设置」，把界面上填的地址也存进去
  const saveBtn = await centerOf(c, `[...document.querySelectorAll('.modal button')].filter(b => b.textContent.includes('保存 AI 设置'))`)
  if (saveBtn) await clickAt(c, saveBtn.x, saveBtn.y)
  await sleep(500)
  // 关掉设置面板
  await evalIn(c, `document.querySelector('.modal-mask')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
  await sleep(400)
  ok.panelClosed = await evalIn(c, `!document.querySelector('.modal')`)

  /* 4. 在编辑器里敲一段话，然后停手等模型 */
  // 先把历史运行可能残留的测试文本清掉，免得断言误判
  detail.preClean = await evalIn(c, `cleanNeedle(${JSON.stringify(REPLY)})`)
  await evalIn(c, `document.querySelector('.ProseMirror')?.focus()`)
  await evalIn(
    c,
    `(()=>{const p=document.querySelector('.ProseMirror'); if(!p) return 0; const r=p.getBoundingClientRect(); p.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:r.x+40,clientY:r.y+20})); p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); return 1})()`,
  )
  await sleep(200)
  // 光标挪到文末：Ctrl+End
  await pressKey(c, 'End', 'End', 35)
  await typeText(c, TYPED)
  detail.typedLen = await evalIn(c, `document.querySelector('.ProseMirror').textContent.length`)

  /* 5. 等幽灵文本 */
  const beforeGhostCount = await evalIn(c, `countNeedle(${JSON.stringify(REPLY)})`)
  let ghost = null
  for (let i = 0; i < 30; i++) {
    ghost = await evalIn(
      c,
      `(()=>{const g=document.querySelector('.quill-ai-ghost'); return g ? JSON.stringify({text:g.textContent, cls:g.className, color:getComputedStyle(g).color}) : null})()`,
    )
    if (ghost && typeof ghost === 'string' && ghost.includes(REPLY)) break
    await sleep(300)
  }
  detail.ghost = ghost
  ok.ghostShown = Boolean(ghost && typeof ghost === 'string' && ghost.includes(REPLY))
  detail.mockSawTyped = detail.lastRequest?.userHasTyped ?? null
  detail.toast = await evalIn(c, `document.querySelector('.toasts')?.textContent ?? ''`)
  ok.promptCarriedContext = detail.mockSawTyped === true
  ok.usedStream = detail.lastRequest?.stream === true
  // 幽灵文本只是装饰，此刻还不该进文档（用出现次数判断，不怕历史残留）
  ok.ghostNotInDoc = (await evalIn(c, `countNeedle(${JSON.stringify(REPLY)})`)) === beforeGhostCount

  // 记录一下编辑器到底收到哪些按键，方便判断 Tab/Esc 有没有送达
  await evalIn(
    c,
    `(()=>{window.__keys=[]; document.querySelector('.ProseMirror').addEventListener('keydown', e => window.__keys.push(e.key), true); return 'ok'})()`,
  )

  /* 6. Tab 接受 —— 注意要查全文，插入点在光标处（多半在文档中间） */
  await pressKey(c, 'Tab', 'Tab', 9)
  detail.keysAfterTab = await evalIn(c, `JSON.stringify(window.__keys ?? [])`)
  const afterTabCount = await evalIn(c, `countNeedle(${JSON.stringify(REPLY)})`)
  detail.tabCount = { before: beforeGhostCount, after: afterTabCount }
  detail.afterTab = await evalIn(c, `JSON.stringify({hasGhost: !!document.querySelector('.quill-ai-ghost')})`)
  ok.tabAccepts =
    afterTabCount === beforeGhostCount + 1 &&
    !String(detail.afterTab).includes('"hasGhost":true')

  /* 7. 再敲一次，这回按 Esc 忽略 */
  await typeText(c, ' again')
  let ghost2 = null
  for (let i = 0; i < 30; i++) {
    // 要等到「有真文本」的 ghost，不能把加载中的省略号也算数
    ghost2 = await evalIn(
      c,
      `(()=>{const g=document.querySelector('.quill-ai-ghost'); return g && g.textContent && g.textContent !== '···' ? true : false})()`,
    )
    if (ghost2 === true) break
    await sleep(300)
  }
  ok.ghostShownAgain = ghost2 === true
  const beforeEsc = await evalIn(c, `docPlain()`)
  await pressKey(c, 'Escape', 'Escape', 27)
  await sleep(300)
  const afterEsc = await evalIn(c, `docPlain()`)
  detail.esc = {
    same: beforeEsc === afterEsc,
    ghostGone: !(await evalIn(c, `!!document.querySelector('.quill-ai-ghost')`)),
  }
  ok.escIgnores = detail.esc.same === true && detail.esc.ghostGone === true
  detail.keysAfterEsc = await evalIn(c, `JSON.stringify((window.__keys ?? []).slice(-4))`)
  detail.captureLog = await evalIn(c, `JSON.stringify((window.__aiTabLog ?? []).slice(-6))`)
  detail.pluginLog = await evalIn(c, `JSON.stringify((window.__aiPluginLog ?? []).slice(-6))`)
} catch (err) {
  detail.error = String(err?.message ?? err)
  console.log('! 出错:', detail.error)
} finally {
  // 关掉测试开关 + 清掉测试用的配置和文本，别给主人留脏数据
  await evalIn(c, `(()=>{ localStorage.setItem('quill-set:ai-enabled','false'); return 1 })()`).catch(() => {})
  await evalIn(c, `cleanNeedle(${JSON.stringify(REPLY)})`).catch(() => {})
  await evalIn(c, `cleanNeedle(${JSON.stringify(TYPED.trim())})`).catch(() => {})
  try {
    rmSync(join(process.env.APPDATA ?? '', 'com.quill.write', 'ai.json'), { force: true })
  } catch {
    /* 没有就没有 */
  }
  c.close()
  server.close()
}

console.log('\n=== 请求内容 ===')
console.log(JSON.stringify(detail.lastRequest ?? null, null, 2))
console.log('\n=== 结论 ===')
console.log(JSON.stringify({ ok, failed: Object.entries(ok).filter(([, v]) => !v).map(([k]) => k) }, null, 2))
console.log('\n=== 细节 ===')
console.log(JSON.stringify(detail, null, 2))
process.exit(0)
