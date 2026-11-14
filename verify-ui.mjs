// 验收：标题栏折叠菜单 + 正文字体设置
const CDP_PORT = Number(process.env.CDP_PORT || 9222)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pages = async () =>
  (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).filter(
    (t) => t.type === 'page' && t.webSocketDebuggerUrl,
  )

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

async function evalIn(c, expression, ms = 8000) {
  const r = await Promise.race([
    c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
    sleep(ms).then(() => ({ __timeout: true })),
  ])
  if (r.__timeout) return { __timeout: true }
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description }
  return r.result?.result?.value
}

const list = await pages()
let main = null
for (const t of list) {
  const c = await connect(t.webSocketDebuggerUrl)
  await c.send('Runtime.enable')
  const label = await evalIn(c, `(()=>{try{return window.__TAURI_INTERNALS__.metadata.currentWindow.label}catch(e){return null}})()`)
  if (label === 'main') {
    main = c
    break
  }
  c.close()
}
if (!main) {
  console.log(JSON.stringify({ error: '没有主窗口' }))
  process.exit(0)
}

const out = {}

// 标题栏现在有几颗按钮
out.titlebar = await evalIn(
  main,
  `JSON.stringify({
    buttons: [...document.querySelectorAll('.titlebar > button, .titlebar > div > button')].map(b => b.title || b.textContent.trim()),
    count: document.querySelectorAll('.titlebar button').length,
  })`,
)

// 展开「⋯ 更多」
await evalIn(main, `(()=>{const b=[...document.querySelectorAll('.titlebar button')].find(x=>x.textContent.trim()==='⋯'); b?.click(); return !!b})()`)
await sleep(500)
out.menu = await evalIn(
  main,
  `JSON.stringify({
    open: !!document.querySelector('.menu.more'),
    items: [...document.querySelectorAll('.menu.more .mi .mi-label')].map(e => e.textContent),
    hints: [...document.querySelectorAll('.menu.more .mi .mi-hint')].map(e => e.textContent),
  })`,
)
// 关掉菜单
await evalIn(main, `document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}))`)

// 打开设置 → 改字体
await evalIn(main, `(()=>{const b=[...document.querySelectorAll('.titlebar button')].find(x=>x.textContent.trim()==='⋯'); b?.click(); return 1})()`)
await sleep(300)
await evalIn(main, `(()=>{const b=[...document.querySelectorAll('.menu.more .mi')].find(x=>x.textContent.includes('备份与设置')); b?.click(); return 1})()`)
await sleep(700)
out.settings = await evalIn(
  main,
  `JSON.stringify({
    open: !!document.querySelector('.modal'),
    hasAppearance: !!document.querySelector('.modal .sc-title'),
    groups: [...document.querySelectorAll('.modal .sc-title')].map(e => e.textContent),
    fontOptions: [...document.querySelectorAll('.modal select option')].map(o => o.textContent),
    preview: document.querySelector('.font-preview')?.textContent?.slice(0, 30) ?? null,
  })`,
)

// 选霞鹜文楷 → 看 CSS 变量和 <link> 有没有插进去
out.afterPick = await evalIn(
  main,
  `(async () => {
    const sel = document.querySelector('.modal select')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    setter.call(sel, 'wenkai')
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 1200))
    const cs = getComputedStyle(document.documentElement)
    const prose = document.querySelector('.ProseMirror')
    return JSON.stringify({
      fontVar: cs.getPropertyValue('--font-prose').trim().slice(0, 60),
      sizeVar: cs.getPropertyValue('--prose-size').trim(),
      leadVar: cs.getPropertyValue('--prose-leading').trim(),
      linkTag: !!document.querySelector('link[data-quill-font="wenkai"]'),
      editorFont: prose ? getComputedStyle(prose).fontFamily.slice(0, 60) : null,
      editorSize: prose ? getComputedStyle(prose).fontSize : null,
      stored: localStorage.getItem('quill-set:proseFont'),
    })
  })()`,
)

console.log(JSON.stringify(out, null, 2))
main.close()
process.exit(0)
