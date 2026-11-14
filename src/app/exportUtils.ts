/**
 * 导出用的浏览器侧小工具：触发下载、拼单文件 HTML。
 */



export function download(name: string, text: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** 把正文 HTML 包成一个自带排版样式的独立文件，发出去就能直接看 */
export function buildStandaloneHtml(title: string, body: string): string {
  const safe = title.replace(
    /[<>&]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c,
  )
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safe}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0 auto; max-width: 720px; padding: 56px 24px 96px;
         font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
         font-size: 16.5px; line-height: 1.85; color: #23201d; background: #faf8f5; }
  h1 { font-size: 1.9em; margin: 1.6em 0 .6em; }
  h2 { font-size: 1.4em; }
  h3 { font-size: 1.15em; }
  h1, h2, h3 { line-height: 1.35; }
  code { background: #efece7; padding: .15em .4em; border-radius: 4px; font-size: .9em; }
  pre { background: #f2efe9; padding: 14px 16px; border-radius: 10px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 1em 0; padding: .2em 1em; border-left: 3px solid #d8d2c8; color: #6b645c; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e2ddd4; padding: 8px 12px; text-align: left; }
  img, video { max-width: 100%; border-radius: 8px; }
  hr { border: none; border-top: 1px solid #e2ddd4; margin: 2em 0; }
  @media (prefers-color-scheme: dark) {
    body { color: #e8e3dc; background: #16150f; }
    code { background: #26241c; }
    pre { background: #1e1c16; }
    blockquote { border-color: #3a362c; color: #a49c90; }
    th, td { border-color: #322f26; }
    hr { border-color: #322f26; }
  }
</style>
</head>
<body>
${body}
</body>
</html>
`
}
