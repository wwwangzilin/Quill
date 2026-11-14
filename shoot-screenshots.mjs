// 重新截 docs/screenshots 里的介绍图（界面改了不少，旧图已经过时）
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const CDP_PORT = Number(process.env.CDP_PORT || 9222)
const OUT = fileURLToPath(new URL('./docs/screenshots/', import.meta.url))
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  await sleep(300)
}
async function centerOf(c, expr, nth = 0) {
  const raw = await evalIn(
    c,
    `(()=>{const els=${expr}; const e=els[${nth}]; if(!e) return 'null'; const r=e.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,w:Math.round(r.width),h:Math.round(r.height)})})()`,
  )
  return raw === 'null' || typeof raw !== 'string' ? null : JSON.parse(raw)
}
async function pressKey(c, key, code, vk, mods = 0) {
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods }
  await c.send('Input.dispatchKeyEvent', { ...base, type: 'keyDown' })
  await c.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' })
  await sleep(350)
}

const shots = []
async function shoot(c, name) {
  // 等动画落定
  await sleep(700)
  const r = await c.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  if (r.result?.data) {
    const path = join(OUT, `${name}.png`)
    writeFileSync(path, Buffer.from(r.result.data, 'base64'))
    shots.push({ name: `${name}.png`, ok: true })
    console.log(`· 已截 ${name}.png`)
  } else {
    shots.push({ name, ok: false })
    console.log(`! ${name} 截图失败`)
  }
}

/** 切主题（用的是 localStorage + documentElement.dataset.theme，直接设最快） */
async function setTheme(c, theme) {
  await evalIn(
    c,
    `(()=>{
      document.documentElement.dataset.theme = ${JSON.stringify(theme)};
      localStorage.setItem('quill-theme', ${JSON.stringify(theme)});
      return 1
    })()`,
  )
  await sleep(400)
}

const list = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).filter(
  (t) => t.type === 'page',
)
const main = list.find((t) => t.title === 'Quill') ?? list[0]
const c = await connect(main.webSocketDebuggerUrl)
await c.send('Page.enable')
await c.send('Runtime.enable')

try {
  for (let i = 0; i < 40; i++) {
    const n = await evalIn(c, `document.querySelectorAll('.doc-item').length`)
    if (typeof n === 'number' && n > 0) break
    await sleep(500)
  }

  // 打开内容最完整的那篇
  const doc = await centerOf(
    c,
    `[...document.querySelectorAll('.doc-item')].filter(e => e.textContent.includes('欢迎使用 Quill'))`,
  )
  if (doc) await clickAt(c, doc.x, doc.y)
  await sleep(900)

  // 收尾动作：折叠选区、滚到顶、确保侧栏展开
  const tidy = async () => {
    await evalIn(
      c,
      `(()=>{
        const ed = window.__quillEditor
        if (ed) {
          ed.commands.setTextSelection(0)
          ed.commands.blur()
        }
        document.querySelector('.editor-scroll')?.scrollTo({ top: 0 })
        return 1
      })()`,
    )
    await sleep(400)
  }

  /* ---------- 暗色：写作 ---------- */
  await setTheme(c, 'dark')
  await tidy()
  await shoot(c, 'dark-write')

  /* ---------- 暗色：命令面板 ---------- */
  await pressKey(c, 'p', 'KeyP', 80, 2)
  await sleep(500)
  await shoot(c, 'dark-palette')
  await pressKey(c, 'Escape', 'Escape', 27)

  /* ---------- 暗色：AI 问答面板 ---------- */
  await pressKey(c, 'a', 'KeyA', 65, 2 | 8)
  await sleep(700)
  await shoot(c, 'dark-ai')
  await evalIn(c, `document.querySelector('.aichat-head button')?.click()`)
  await sleep(400)

  /* ---------- 暗色：导图 ---------- */
  const mapBtn = await centerOf(c, `[...document.querySelectorAll('.seg button')]`, 1)
  if (mapBtn) await clickAt(c, mapBtn.x, mapBtn.y)
  await sleep(1400)
  await shoot(c, 'dark-mindmap')

  /* ---------- 亮色：写作 ---------- */
  const writeBtn = await centerOf(c, `[...document.querySelectorAll('.seg button')]`, 0)
  if (writeBtn) await clickAt(c, writeBtn.x, writeBtn.y)
  await sleep(900)
  await setTheme(c, 'light')
  await tidy()
  await shoot(c, 'light-write')

  // 收尾：回到暗色（应用默认就是暗的）
  await setTheme(c, 'dark')
  await tidy()
} catch (err) {
  console.log('! 出错:', String(err?.message ?? err))
}

c.close()
console.log('\n结果:', JSON.stringify(shots, null, 2))
process.exit(0)
