/**
 * 媒体路径转换。
 *
 * 文档里存的是仓库内相对路径（`assets/xxx.png`），这样换机器、
 * 拿别的编辑器打开都还在。但编辑器要显示它，得换成 WebView 能取的 URL
 * （Tauri 的 asset 协议）。所以读的时候转进去、写的时候转回来。
 */

type Resolver = (rel: string) => string

let resolver: Resolver | null = null

/** App 启动时注入（浏览器模式不注入，保持相对路径原样） */
export function setAssetResolver(fn: Resolver | null) {
  resolver = fn
}

const ABSOLUTE = /^(https?:|data:|blob:|asset:|file:)/i

/** 相对路径 → 可显示的 URL */
export function assetUrl(rel: string): string {
  if (!rel || ABSOLUTE.test(rel)) return rel
  if (!resolver) return rel
  try {
    return resolver(rel)
  } catch {
    return rel
  }
}

/** 可显示的 URL → 相对路径（写进 .md 用） */
export function relOf(src: string): string {
  if (!src) return src
  const direct = src.match(/^assets[/\\](.+)$/i)
  if (direct) return `assets/${direct[1].replace(/\\/g, '/')}`
  // Tauri 的 asset:// URL 整条是 encodeURIComponent 过的（%5C 而不是 \），
  // 得先解码才找得到 assets/ 这一段
  let probe = src
  try {
    probe = decodeURIComponent(src)
  } catch {
    probe = src
  }
  const m = probe.match(/assets[/\\]([^/\\?#"']+)/i)
  // 匹配不上就原样返回 —— 别把普通网址解码后写进文档
  return m ? `assets/${m[1]}` : src
}
