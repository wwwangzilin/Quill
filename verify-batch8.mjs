// 第五批功能验收：表格 / 代码块语法高亮 / 复制为富文本 / 写作目标与连续天数
import { rmSync } from 'node:fs'
import { join } from 'node:path'

const CDP_PORT = Number(process.env.CDP_PORT || 9222)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ok = {}
const detail = {}

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
  await sleep(260)
}
async function centerOf(c, expr, nth = 0) {
  const raw = await evalIn(
    c,
    `(()=>{const els=${expr}; const e=els[${nth}]; if(!e) return 'null'; const r=e.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`,
  )
  return raw === 'null' || typeof raw !== 'string' ? null : JSON.parse(raw)
}

const list = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).filter(
  (t) => t.type === 'page',
)
const main = list.find((t) => t.title === 'Quill') ?? list[0]
const c = await connect(main.webSocketDebuggerUrl)
await c.send('Runtime.enable')

try {
  for (let i = 0; i < 40; i++) {
    const n = await evalIn(c, `document.querySelectorAll('.doc-item').length`)
    if (typeof n === 'number' && n > 0) break
    await sleep(500)
  }

  /* ================= ① 表格 ================= */
  detail.tableInsert = await evalIn(
    c,
    `(()=>{
      const ed = window.__quillEditor
      ed.commands.focus('end')
      ed.commands.insertTable({ rows: 2, cols: 3, withHeaderRow: true })
      return 'ok'
    })()`,
  )
  await sleep(600)
  detail.tableDom = await evalIn(
    c,
    `JSON.stringify({
      tables: document.querySelectorAll('.ProseMirror table').length,
      headers: document.querySelectorAll('.ProseMirror th').length,
      cells: document.querySelectorAll('.ProseMirror td').length,
      inWrapper: !!document.querySelector('.ProseMirror .tableWrapper table'),
    })`,
  )
  ok.tableInserts = String(detail.tableDom).includes('"tables":1')
  ok.tableShape = String(detail.tableDom).includes('"headers":3') && String(detail.tableDom).includes('"cells":3')

  // 文档 JSON 里也该有 table 节点（→ 会被序列化成 GFM 表格存进 .md）
  detail.tableJson = await evalIn(
    c,
    `(()=>{
      const json = window.__quillEditor.getJSON()
      const types = []
      const walk = (n) => { if (!n || typeof n !== 'object') return; if (n.type) types.push(n.type); (n.content||[]).forEach(walk) }
      walk(json)
      return JSON.stringify({ hasTable: types.includes('table'), hasRow: types.includes('tableRow'), hasHeader: types.includes('tableHeader'), hasCell: types.includes('tableCell') })
    })()`,
  )
  ok.tableInJson = !String(detail.tableJson).includes('false')

  // 表格操作：加一列 / 删一行（证明表格是活的，不是死图）
  detail.tableOps = await evalIn(
    c,
    `(()=>{
      const ed = window.__quillEditor
      const before = document.querySelectorAll('.ProseMirror th').length
      ed.commands.addColumnAfter()
      const after = document.querySelectorAll('.ProseMirror th').length
      return JSON.stringify({ before, after })
    })()`,
  )
  ok.tableColumnOp = (() => {
    const m = String(detail.tableOps).match(/"before":(\d+),"after":(\d+)/)
    return m ? Number(m[2]) === Number(m[1]) + 1 : false
  })()

  // 撤销，别把测试表格留在文档里
  await evalIn(c, `window.__quillEditor.commands.undo(); window.__quillEditor.commands.undo()`)
  await sleep(400)

  /* ================= ② 代码块语法高亮 ================= */
  detail.codeInsert = await evalIn(
    c,
    `(()=>{
      const ed = window.__quillEditor
      ed.commands.focus('end')
      ed.commands.insertContent({ type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'const answer = 42 // 高亮我' }] })
      return 'ok'
    })()`,
  )
  await sleep(700)
  detail.codeDom = await evalIn(
    c,
    `JSON.stringify({
      pre: document.querySelectorAll('.ProseMirror pre').length,
      spans: document.querySelectorAll('.ProseMirror pre code span[class^="hljs-"]').length,
      keywords: document.querySelectorAll('.ProseMirror pre code .hljs-keyword, .ProseMirror pre code .hljs-variable, .ProseMirror pre code .hljs-number').length,
      comment: document.querySelectorAll('.ProseMirror pre code .hljs-comment').length,
    })`,
  )
  ok.codeHighlighted = (() => {
    const m = String(detail.codeDom).match(/"spans":(\d+)/)
    return m ? Number(m[1]) > 0 : false
  })()
  ok.codeHasComment = String(detail.codeDom).includes('"comment":1')

  await evalIn(c, `window.__quillEditor.commands.undo()`)
  await sleep(400)

  /* ================= ③ 复制为富文本 ================= */
  // 走真实 UI：⋯ 菜单 → 复制为富文本
  const more = await centerOf(c, `[...document.querySelectorAll('.titlebar button')].filter(b => b.textContent.trim() === '⋯')`)
  if (more) await clickAt(c, more.x, more.y)
  await sleep(350)
  const richItem = await evalIn(
    c,
    `(()=>{
      const el = [...document.querySelectorAll('.menu.more .mi')].find(e => e.textContent.includes('复制为富文本'))
      if (!el) return 'null'
      const r = el.getBoundingClientRect()
      return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2 })
    })()`,
  )
  ok.menuHasRichCopy = richItem !== 'null'
  if (richItem !== 'null') {
    const p = JSON.parse(richItem)
    await clickAt(c, p.x, p.y)
  }
  await sleep(700)
  detail.toast = await evalIn(c, `document.querySelector('.toasts')?.textContent ?? ''`)
  ok.richCopyToast = String(detail.toast).includes('已复制为富文本')

  /* ================= ④ 写作目标与连续天数 ================= */
  detail.goalDom = await evalIn(
    c,
    `JSON.stringify({
      hasGoal: !!document.querySelector('.goal'),
      today: document.querySelector('.goal-today')?.textContent ?? null,
      rest: document.querySelector('.goal-rest')?.textContent ?? null,
      streak: document.querySelector('.goal-streak')?.textContent ?? null,
      bar: !!document.querySelector('.goal-bar'),
    })`,
  )
  ok.goalShown = String(detail.goalDom).includes('"hasGoal":true') && /今天\s*\d+\s*字/.test(String(detail.goalDom))
  ok.streakShown = /连续写作 \d+ 天|今天开个头吧/.test(String(detail.goalDom))

  // 目标设成 0 时不该有进度条
  await evalIn(c, `localStorage.setItem('quill-set:daily-goal','0')`)
  detail.note = '目标是 React state，改 localStorage 不会立刻生效，这里只记录 DOM 现状'
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
}

console.log('\n=== 结论 ===')
console.log(JSON.stringify({ ok, failed: Object.entries(ok).filter(([, v]) => !v).map(([k]) => k) }, null, 2))
console.log('\n=== 细节 ===')
console.log(JSON.stringify(detail, null, 2))
process.exit(0)
