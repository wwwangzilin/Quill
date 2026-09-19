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
  const m = src.match(/assets[/\\]([^/\\?#"']+)/i)
  if (m) return `assets/${m[1]}`
  return src
}
