// 极简静态服务器：专门伺候 dist/ 产物做验收（不走 vite，避开沙箱 exec 限制）
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('./dist/', import.meta.url))
const PORT = Number(process.env.PORT || 4178)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    let path = decodeURIComponent(url.pathname)
    if (path === '/' || path === '') path = '/index.html'
    // 探针回报通道：页面内同步 XHR 把断言结果 POST 回来
    if (req.method === 'POST' && path === '/__probe') {
      const chunks = []
      for await (const c of req) chunks.push(c)
      const body = Buffer.concat(chunks).toString('utf8')
      await import('node:fs/promises').then((fs) =>
        fs.writeFile(fileURLToPath(new URL('./.verify/probe.json', import.meta.url)), body, 'utf8'),
      )
      res.writeHead(204).end()
      return
    }

    const file = join(root, normalize(path).replace(/^[/\\]+/, ''))
    let served = file
    let data
    try {
      data = await readFile(file)
    } catch {
      served = join(root, 'index.html')
      data = await readFile(served)
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(served)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(data)
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(String(err))
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[serve] ${root} -> http://127.0.0.1:${PORT}`)
})
