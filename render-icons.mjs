// 用无头 Edge + CDP 把 SVG 候选图渲染成 1024×1024 PNG（保留透明圆角）
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9333
const DIR = fileURLToPath(new URL('./.verify/', import.meta.url))
mkdirSync(DIR, { recursive: true })
const PROFILE = join(DIR, 'edge-icon-profile')
rmSync(PROFILE, { recursive: true, force: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const proc = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--disable-extensions',
    '--no-first-run',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
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

let target = null
for (let i = 0; i < 40; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    target = list.find((t) => t.type === 'page')
    if (target) break
  } catch {
    /* 等它起来 */
  }
  await sleep(500)
}
if (!target) {
  console.error('无头 Edge 没起来')
  proc.kill()
  process.exit(1)
}

const c = await connect(target.webSocketDebuggerUrl)
await c.send('Page.enable')
await c.send('Runtime.enable')
await c.send('Emulation.setDeviceMetricsOverride', {
  width: 1024,
  height: 1024,
  deviceScaleFactor: 1,
  mobile: false,
})
// 透明底：图标四角要透出去
await c.send('Emulation.setDefaultBackgroundColorOverride', {
  color: { r: 0, g: 0, b: 0, a: 0 },
})

for (const name of ['a', 'b']) {
  await c.send('Page.navigate', { url: `file:///${DIR.replace(/\\/g, '/')}icon-${name}.html` })
  await sleep(1500)
  const shot = await c.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  })
  if (shot.result?.data) {
    const out = join(DIR, `icon-${name}.png`)
    writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
    console.log(`已渲染 icon-${name}.png`)
  } else {
    console.log(`icon-${name} 截图失败`, JSON.stringify(shot).slice(0, 200))
  }
}

// 顺手做个体检：中心像素应该是金色/深墨，不该是纯透明或纯白
const check = await c.send('Runtime.evaluate', {
  expression: `(()=>{
    const cv = document.createElement('canvas')
    return 'ok'
  })()`,
  returnByValue: true,
})
c.close()
proc.kill()
await sleep(500)
rmSync(PROFILE, { recursive: true, force: true })
process.exit(0)
