// 验收「点得动」：⋯ 菜单每一项、设置弹窗里的控件，都要能被真实鼠标点中
const CDP_PORT = Number(process.env.CDP_PORT || 9222)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const list = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).filter((t) => t.type === 'page')

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
async function evalIn(c, expression, ms = 8000) {
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
async function centerOf(c, sel, nth = 0) {
  const raw = await evalIn(
    c,
    `(()=>{const els=[...document.querySelectorAll(${JSON.stringify(sel)})]; const e=els[${nth}]; if(!e) return 'null'; const r=e.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`,
  )
  return raw === 'null' ? null : JSON.parse(raw)
}

const c = await connect(list[0].webSocketDebuggerUrl)
await c.send('Runtime.enable')
const out = { ok: {}, detail: {} }

// 1) ⋯ 菜单：每一项的命中测试
// 先把可能开着的菜单关掉，免得这一下点击反而把它关上了
await evalIn(c, `document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}))`)
await sleep(300)
const more = await centerOf(c, '.titlebar button[title^="更多"]')
await clickAt(c, more.x, more.y)
await sleep(400)
out.detail.menuItemsHit = await evalIn(
  c,
  `(()=>{
    const items=[...document.querySelectorAll('.menu.more .mi')]
    const bad=[]
    for (const b of items) {
      const r=b.getBoundingClientRect(); const x=r.x+r.width/2, y=r.y+r.height/2
      const top=document.elementFromPoint(x,y)
      const hit = !!top && (b===top || b.contains(top))
      if(!hit) bad.push({text:b.textContent.trim().slice(0,8), top: top?top.tagName+'.'+(typeof top.className==='string'?top.className:''):'null'})
    }
    return JSON.stringify({total:items.length, bad})
  })()`,
)
out.ok.menuItemsClickable = JSON.parse(out.detail.menuItemsHit).bad.length === 0

// 2) 点「备份与设置」→ 设置弹窗要开
const settingsItem = await centerOf(c, '.menu.more .mi', 6)
if (settingsItem) await clickAt(c, settingsItem.x, settingsItem.y)
await sleep(600)
out.ok.settingsOpened = await evalIn(c, `!!document.querySelector('.modal')`)

// 3) 弹窗里的控件命中测试
// 弹窗体是可滚动的：顶部的字体下拉和底部的保存按钮不在同一屏，
// 所以要分两次滚到位再测（否则「命中失败」其实是滚出视口了）
out.detail.modalHits = await evalIn(
  c,
  `(async () => {
    const body = document.querySelector('.modal-body')
    const probe=(name,el)=>{
      if(!el) return {name, missing:true}
      const r=el.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2
      const top=document.elementFromPoint(x,y)
      return {name, hit: !!top && (el===top || el.contains(top)), top: top?top.tagName+'.'+(typeof top.className==='string'?top.className:''):'null'}
    }
    const wait = () => new Promise(r => setTimeout(r, 260))
    const out = []
    if (body) { body.scrollTop = 0; await wait() }
    out.push(probe('字体下拉', document.querySelector('.modal select')))
    out.push(probe('字号滑条', document.querySelectorAll('.modal input[type=range]')[0]))
    out.push(probe('关闭×', document.querySelector('.modal-head button')))
    if (body) { body.scrollTop = body.scrollHeight; await wait() }
    out.push(probe('恢复默认', [...document.querySelectorAll('.modal button')].find(b=>b.textContent.includes('恢复默认'))))
    out.push(probe('保存设置', [...document.querySelectorAll('.modal button')].find(b=>b.textContent.includes('保存设置'))))
    if (body) { body.scrollTop = 0; await wait() }
    return JSON.stringify(out)
  })()`,
)
out.ok.modalControlsClickable = JSON.parse(out.detail.modalHits).every((x) => x.hit)

// 4) 先切成霞鹜文楷，再真点「恢复默认」→ 字体设置应被写回 system
await evalIn(
  c,
  `(()=>{
    const sel = document.querySelector('.modal select')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    setter.call(sel, 'wenkai')
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return 1
  })()`,
)
await sleep(500)
const before = await evalIn(c, `localStorage.getItem('quill-set:proseFont')`)
const resetBtn = await evalIn(
  c,
  `(()=>{const b=[...document.querySelectorAll('.modal button')].find(x=>x.textContent.includes('恢复默认')); if(!b) return 'null'; const r=b.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`,
)
if (resetBtn !== 'null') {
  const p = JSON.parse(resetBtn)
  await clickAt(c, p.x, p.y)
}
const after = await evalIn(c, `localStorage.getItem('quill-set:proseFont')`)
out.detail.reset = { before, after }
out.ok.resetWorks = before === '"wenkai"' && after === '"system"'

// 5) 关掉弹窗，测侧栏「新建」模板菜单
await evalIn(c, `document.querySelector('.modal-mask')?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`)
await sleep(400)
out.ok.modalClosed = await evalIn(c, `!document.querySelector('.modal')`)

console.log(JSON.stringify(out, null, 2))
c.close()
process.exit(0)
