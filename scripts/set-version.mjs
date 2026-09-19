/**
 * 把发布版本号写进三个地方：
 *   package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml
 *
 * 用法：node scripts/set-version.mjs v0.2.0    （v 可有可无）
 *
 * 为什么需要它：打 tag 发版时，tag 才是版本的唯一真相源。
 * 如果只打 tag 不同步文件，构建出来的安装包版本号还是旧的
 * ——装上去显示 0.1.0、覆盖安装还会被当成同一个版本。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const raw = (process.argv[2] ?? '').trim()
const version = raw.replace(/^[vV]/, '')

if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`版本号不合法：${JSON.stringify(raw)}`)
  console.error('期望形如 v0.2.0 / 0.2.0 / v0.2.0-beta.1')
  process.exit(1)
}

/** 只替换第一个 "version" 字段那一行，其余格式一个字符都不动（diff 才干净） */
function patchJson(path) {
  const before = readFileSync(path, 'utf8')
  const re = /^([ \t]*"version"[ \t]*:[ \t]*)"([^"]*)"/m
  const found = before.match(re)
  if (!found) {
    console.error(`没能改到 ${path} 的 version 字段`)
    process.exit(1)
  }
  writeFileSync(path, before.replace(re, `$1"${version}"`), 'utf8')
  return found[2]
}

/** Cargo.toml 只动 [package] 段里的 version，别碰依赖的版本号 */
function patchCargo(path) {
  const before = readFileSync(path, 'utf8')
  const after = before.replace(
    /(\[package\][\s\S]*?^version\s*=\s*)"[^"]*"/m,
    (_m, head) => `${head}"${version}"`,
  )
  if (after === before) {
    console.error(`没能改到 ${path} 的 [package] version`)
    process.exit(1)
  }
  const old = before.match(/\[package\][\s\S]*?^version\s*=\s*"([^"]*)"/m)?.[1] ?? '?'
  writeFileSync(path, after, 'utf8')
  return old
}

const a = patchJson('package.json')
const b = patchJson('src-tauri/tauri.conf.json')
const c = patchCargo('src-tauri/Cargo.toml')

console.log(`版本号已同步为 ${version}`)
console.log(`  package.json          ${a} -> ${version}`)
console.log(`  tauri.conf.json       ${b} -> ${version}`)
console.log(`  src-tauri/Cargo.toml  ${c} -> ${version}`)
