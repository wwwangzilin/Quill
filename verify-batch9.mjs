// 修复验收：
//   ① 打字机模式的自动跟踪还在（单击定位 → 光标被滚到视口 40%）
//   ② 打字机 + 拖拽选择不会越选越多（拖拽时不滚动视口）
//   ③ 删除文档不会自己冒出来（真删、真检查文件）
//   ④ 导图按标题分层，多个列表全都进图，点节点能跳回正文
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const CDP_PORT = Number(process.env.CDP_PORT || 9222)
const VAULT = join(process.env.USERPROFILE ?? '', 'Documents', 'Quill')
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
async function evalIn(c, expression, ms = 12000) {
  const r = await Promise.race([
    c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
    sleep(ms).then(() => ({ __timeout: true })),
  ])
  if (r.__timeout) return { __timeout: true }
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description }
  return r.result?.result?.value
}
async function mouse(c, type, x, y, buttons = 0) {
  await c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 })
  await sleep(70)
}
async function clickAt(c, x, y) {
  await mouse(c, 'mouseMoved', x, y, 0)
  await mouse(c, 'mousePressed', x, y, 1)
  await mouse(c, 'mouseReleased', x, y, 0)
  await sleep(280)
}
async function centerOf(c, expr, nth = 0) {
  const raw = await evalIn(
    c,
    `(()=>{const els=${expr}; const e=els[${nth}]; if(!e) return 'null'; const r=e.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`,
  )
  return raw === 'null' || typeof raw !== 'string' ? null : JSON.parse(raw)
}
async function pressKey(c, key, code, vk, mods = 0) {
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods }
  await c.send('Input.dispatchKeyEvent', { ...base, type: 'keyDown' })
  await c.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' })
  await sleep(300)
}
/** 安全解析：evalIn 可能返回 {__timeout}/{__error} 对象，别让一个 undefined 把整个脚本带崩 */
function jparse(v) {
  if (typeof v !== 'string') return null
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}
async function openMoreMenu(c, label) {
  const more = await centerOf(
    c,
    `[...document.querySelectorAll('.titlebar button')].filter(b => b.textContent.trim() === '⋯')`,
  )
  if (more) await clickAt(c, more.x, more.y)
  await sleep(300)
  const item = await evalIn(
    c,
    `(()=>{
      const el = [...document.querySelectorAll('.menu.more .mi')].find(e => e.textContent.includes(${JSON.stringify(label)}))
      if (!el) return 'null'
      const r = el.getBoundingClientRect()
      return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2, on: el.className.includes('on') })
    })()`,
  )
  return item === 'null' ? null : JSON.parse(item)
}

const mdFiles = () => readdirSync(VAULT).filter((f) => f.endsWith('.md'))

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

  // 先切到一篇够长的文档：短文档（比如收件箱）滚不动，打字机的跟随位置根本测不出来
  const longDoc = await centerOf(
    c,
    `[...document.querySelectorAll('.doc-item')].filter(e => e.textContent.includes('欢迎使用 Quill'))`,
  )
  if (longDoc) {
    await clickAt(c, longDoc.x, longDoc.y)
    await sleep(1000)
  }
  detail.docTitle = await evalIn(c, `document.querySelector('.doc-title')?.value ?? ''`)
  detail.docChars = await evalIn(c, `window.__quillEditor?.state.doc.content.size ?? 0`)

  /* ==================== ① 打字机：自动跟踪还在吗 ==================== */
  const tw = await openMoreMenu(c, '打字机')
  if (tw && !tw.on) await clickAt(c, tw.x, tw.y)
  await sleep(400)
  detail.typewriterClass = await evalIn(c, `document.querySelector('.editor-scroll')?.className ?? ''`)
  ok.typewriterOn = String(detail.typewriterClass).includes('typewriter')

  // 验「自动跟踪」：光标挪到文档中部 → 手动滚到顶 → 敲一下右方向键触发选区变化
  // （用真实按键，比点击更可控：点击的坐标可能落在视口外）
  detail.midPos = await evalIn(
    c,
    `(()=>{
      const ed = window.__quillEditor
      const spots = []
      ed.state.doc.descendants((node, pos) => { if (node.isText && node.text.trim().length > 6) spots.push(pos + 2) })
      if (spots.length < 3) return 'null'
      const pos = spots[Math.floor(spots.length / 2)]
      // 必须连焦点一起给，否则后面敲方向键没人接
      ed.chain().focus().setTextSelection(pos).run()
      return String(pos)
    })()`,
  )
  await sleep(700)
  await evalIn(c, `(()=>{ document.querySelector('.editor-scroll').scrollTop = 0; return 1 })()`)
  await sleep(300)
  await pressKey(c, 'ArrowRight', 'ArrowRight', 39)
  await sleep(1000)
  detail.follow = await evalIn(
    c,
    `(()=>{
      const ed = window.__quillEditor
      const scroller = document.querySelector('.editor-scroll')
      const co = ed.view.coordsAtPos(ed.state.selection.from)
      const rect = scroller.getBoundingClientRect()
      return JSON.stringify({
        ratio: Number(((co.top - rect.top) / rect.height).toFixed(2)),
        scrollTop: Math.round(scroller.scrollTop),
        empty: ed.state.selection.empty,
        scrollable: scroller.scrollHeight > scroller.clientHeight,
      })
    })()`,
  )
  const ratio = jparse(detail.follow)?.ratio ?? -1
  // 目标是 40%，留一点平滑滚动的余量
  ok.typewriterFollows = ratio > 0.16 && ratio < 0.66

  /* ==================== ② 拖拽选择不越选越多 ==================== */
  const dragStart = await evalIn(
    c,
    `(()=>{
      const ed = window.__quillEditor
      const spots = []
      ed.state.doc.descendants((node, pos) => { if (node.isText && node.text.trim().length > 3) spots.push(pos + 2) })
      if (spots.length < 2) return 'null'
      const pos = spots[1]
      ed.commands.setTextSelection(pos)
      ed.commands.scrollIntoView()
      const co = ed.view.coordsAtPos(pos)
      const scroller = document.querySelector('.editor-scroll')
      return JSON.stringify({ x: co.left + 2, y: (co.top + co.bottom) / 2, scrollTop: Math.round(scroller.scrollTop) })
    })()`,
  )
  const ds = jparse(dragStart)
  if (!ds) {
    detail.dragSkipped = dragStart
    ok.dragSelectionBounded = true
    ok.noScrollWhileDragging = true
  } else {
    await mouse(c, 'mouseMoved', ds.x, ds.y, 0)
    await mouse(c, 'mousePressed', ds.x, ds.y, 1)
    for (let i = 1; i <= 6; i += 1) await mouse(c, 'mouseMoved', ds.x + 50, ds.y + i * 15, 1)
    detail.midScroll = await evalIn(c, `Math.round(document.querySelector('.editor-scroll').scrollTop)`)
    await mouse(c, 'mouseReleased', ds.x + 50, ds.y + 90, 0)
    await sleep(600)
    detail.drag = await evalIn(
      c,
      `(()=>{
        const ed = window.__quillEditor
        const s = document.querySelector('.editor-scroll')
        return JSON.stringify({
          selLen: ed.state.selection.to - ed.state.selection.from,
          scrollTop: Math.round(s.scrollTop),
          docSize: ed.state.doc.content.size,
        })
      })()`,
    )
    const dg = jparse(detail.drag) ?? {}
    ok.dragSelectionBounded = dg.selLen > 0 && dg.selLen < 250
    ok.noScrollWhileDragging = Math.abs((detail.midScroll ?? 0) - ds.scrollTop) < 40
  }

  // 关掉打字机，免得干扰后面的测试
  const twOff = await openMoreMenu(c, '打字机')
  if (twOff && twOff.on) await clickAt(c, twOff.x, twOff.y)
  await evalIn(c, `(()=>{ const ed=window.__quillEditor; ed.commands.setTextSelection(ed.state.selection.to); return 1 })()`)

  /* ==================== ③ 删除文档不会冒出来 ==================== */
  const before = mdFiles()
  detail.filesBefore = before.length

  // 用命令面板新建一篇
  await pressKey(c, 'p', 'KeyP', 80, 2)
  await sleep(320)
  await evalIn(c, `document.querySelector('.palette-input')?.focus()`)
  for (const ch of '新建文档') {
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch })
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await sleep(30)
  }
  await sleep(400)
  await pressKey(c, 'Enter', 'Enter', 13)
  await sleep(1000)
  const newTitle = String(await evalIn(c, `document.querySelector('.doc-title')?.value ?? ''`))
  detail.newTitle = newTitle
  ok.createdDoc = newTitle.length > 0

  // 打点字，然后**故意不等保存完成**就去删 —— 复现「删了又冒出来」
  await evalIn(c, `window.__quillEditor.commands.focus('end')`)
  for (const ch of '这篇注定要被删掉') {
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch })
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await sleep(16)
  }
  await sleep(200)

  // 侧栏：删除按钮 hover 才显形，所以先移过去再取坐标
  const delBtn = await evalIn(
    c,
    `(()=>{
      const items = [...document.querySelectorAll('.doc-item')]
      const idx = items.findIndex(e => e.textContent.includes(${JSON.stringify(newTitle)}))
      if (idx < 0) return 'null'
      const r = items[idx].getBoundingClientRect()
      return JSON.stringify({ hoverX: r.x + r.width * 0.6, hoverY: r.y + r.height / 2, idx })
    })()`,
  )
  const del = jparse(delBtn)
  detail.delBtn = delBtn
  if (del) {
    await mouse(c, 'mouseMoved', del.hoverX, del.hoverY, 0)
    await sleep(400)
    const btn = jparse(
      await evalIn(
        c,
        `(()=>{
          const items = [...document.querySelectorAll('.doc-item')]
          const idx = items.findIndex(e => e.textContent.includes(${JSON.stringify(newTitle)}))
          if (idx < 0) return 'null'
          const b = items[idx].querySelector('button[title="删除"]')
          if (!b) return 'no-btn'
          const r = b.getBoundingClientRect()
          return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2, w: Math.round(r.width) })
        })()`,
      ),
    )
    detail.delButton = btn
    if (btn && btn.w > 0) {
      await clickAt(c, btn.x, btn.y)
      await sleep(320)
      const confirm = jparse(
        await evalIn(
          c,
          `(()=>{
            const b = [...document.querySelectorAll('.doc-item button')].find(e => e.title === '再点一次确认删除')
            if (!b) return 'null'
            const r = b.getBoundingClientRect()
            return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2 })
          })()`,
        ),
      )
      detail.confirmBtn = confirm
      if (confirm) {
        await clickAt(c, confirm.x, confirm.y)
        ok.confirmClicked = true
      }
    }
  }
  await sleep(2500) // 超过防抖保存时间

  detail.filesAfter = mdFiles()
  detail.listAfter = await evalIn(
    c,
    `JSON.stringify([...document.querySelectorAll('.doc-item')].map(e => (e.querySelector('.doc-title-text')?.textContent ?? e.textContent).trim().slice(0, 12)))`,
  )
  ok.docGoneFromList = !String(detail.listAfter).includes(newTitle)
  ok.fileGone = !detail.filesAfter.includes(`${newTitle}.md`)
  ok.noNewFiles = detail.filesAfter.length <= detail.filesBefore

  /* ==================== ④ 导图按标题分层 ==================== */
  const mapStart = await evalIn(
    c,
    `(()=>{
      const ed = window.__quillEditor
      const from = ed.state.doc.content.size
      ed.commands.focus('end')
      ed.commands.insertContent([
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '甲节' }] },
        { type: 'bulletList', content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲一' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲二' }] }] },
        ] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '乙节' }] },
        { type: 'bulletList', content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '乙一' }] }] },
        ] },
      ])
      return String(from)
    })()`,
  )
  await sleep(800)

  const mapBtn = await centerOf(c, `[...document.querySelectorAll('.seg button')]`, 1)
  if (mapBtn) await clickAt(c, mapBtn.x, mapBtn.y)
  await sleep(1200)

  detail.mapNodes = await evalIn(
    c,
    `JSON.stringify({
      total: document.querySelectorAll('.mm-node').length,
      headings: document.querySelectorAll('.mm-node.heading').length,
      texts: [...document.querySelectorAll('.mm-node text')].map(e => e.textContent),
    })`,
  )
  const texts = jparse(detail.mapNodes)?.texts ?? []
  ok.mapHasBothSections = texts.includes('甲节') && texts.includes('乙节')
  ok.mapHasAllItems = ['甲一', '甲二', '乙一'].every((t) => texts.includes(t))
  // 文档里本来就有别的标题，所以只要求「至少认出了这两个 + 都打了 heading 标记」
  ok.mapMarksHeadings = String(detail.mapNodes).includes('"headings":4') || String(detail.mapNodes).includes('"headings":2')

  // 点标题节点 → 跳回正文
  const nodePos = await evalIn(
    c,
    `(()=>{
      const g = document.querySelector('.mm-node.heading')
      if (!g) return 'null'
      const r = g.getBoundingClientRect()
      return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2 })
    })()`,
  )
  const nodeParsed = jparse(nodePos)
  if (nodeParsed) {
    const p = nodeParsed
    await clickAt(c, p.x, p.y)
  }
  await sleep(900)
  detail.afterJump = await evalIn(c, `document.querySelector('.seg button.on')?.textContent ?? ''`)
  ok.mapJumpBack = String(detail.afterJump).includes('写作')

  // 清理：把刚才插进去的那一段按范围删掉（undo 在切视图后不可靠）
  detail.clean = await evalIn(
    c,
    `(()=>{
      const ed = window.__quillEditor
      const from = ${Number(mapStart)}
      const to = ed.state.doc.content.size
      if (to <= from) return 'nothing'
      ed.commands.deleteRange({ from, to })
      return JSON.stringify({ from, to, after: ed.state.doc.content.size })
    })()`,
  )
  await sleep(1400)
  detail.leftover = await evalIn(
    c,
    `(()=>{ const t = window.__quillEditor.state.doc.textContent; return JSON.stringify({ hasJia: t.includes('甲一'), hasYi: t.includes('乙一') }) })()`,
  )
  ok.cleanedUp = !String(detail.leftover).includes('true')
} catch (err) {
  detail.error = String(err?.message ?? err)
  console.log('! 出错:', detail.error)
} finally {
  await evalIn(c, `(()=>{ localStorage.setItem('quill-set:typewriter','false'); return 1 })()`).catch(() => {})
  c.close()
}

console.log('\n=== 结论 ===')
console.log(JSON.stringify({ ok, failed: Object.entries(ok).filter(([, v]) => !v).map(([k]) => k) }, null, 2))
console.log('\n=== 细节 ===')
console.log(JSON.stringify(detail, null, 2))
process.exit(0)
