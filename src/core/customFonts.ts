/**
 * 导入自己的字体（.ttf / .otf / .woff / .woff2）。
 *
 * 字节存进 IndexedDB（localStorage 放不下几 MB 的字体），启动时读出来
 * 用 FontFace 注册给整个页面，之后和内置字体一样在下拉里选。
 * 字体文件留在这台机器的浏览器存储里，不进文档仓库、不上传。
 */
import { useEffect, useState } from 'react'
import { FONTS_EVENT, allFonts, setCustomFonts, type FontOption } from './fonts'

const DB = 'quill-fonts'
const STORE = 'fonts'
export const MAX_FONT_BYTES = 40 * 1024 * 1024
const OK_EXT = /\.(ttf|otf|woff2?)$/i

interface Rec {
  id: string
  name: string
  data: ArrayBuffer
  added: number
}

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' })
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((res, rej) => {
      const r = f(db.transaction(STORE, mode).objectStore(STORE))
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
  } finally {
    db.close()
  }
}

/** 文件名 → 显示名：去扩展名、下划线变空格 */
export function fontDisplayName(file: string): string {
  return file.replace(OK_EXT, '').replace(/[_]+/g, ' ').trim() || '自定义字体'
}

export function isFontFile(name: string): boolean {
  return OK_EXT.test(name)
}

const family = (id: string) => `quill-cf-${id}`

function toOption(r: Pick<Rec, 'id' | 'name'>): FontOption {
  return {
    id: r.id,
    name: `${r.name}（已导入）`,
    stack: `"${family(r.id)}", var(--font-ui)`,
    probe: '',
    hint: '你自己导入的字体，存在本机',
  }
}

async function register(r: Rec): Promise<void> {
  const face = new FontFace(family(r.id), r.data)
  await face.load()
  document.fonts.add(face)
}

let loaded = false
/** 启动 / 第一次用到时读出所有导入的字体并注册；坏掉的那个跳过 */
export async function loadCustomFonts(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const all = await tx<Rec[]>('readonly', (s) => s.getAll() as IDBRequest<Rec[]>)
    const ok: FontOption[] = []
    for (const r of all.sort((a, b) => a.added - b.added)) {
      try {
        await register(r)
        ok.push(toOption(r))
      } catch {
        /* 字体文件坏了：不注册，也不让整个列表挂掉 */
      }
    }
    setCustomFonts(ok)
  } catch {
    /* IndexedDB 不可用（隐私模式）：就当没有导入过 */
  }
}

export async function addCustomFont(file: File): Promise<FontOption> {
  if (!isFontFile(file.name)) throw new Error('只支持 .ttf / .otf / .woff / .woff2')
  if (file.size > MAX_FONT_BYTES) throw new Error(`字体文件太大（上限 ${MAX_FONT_BYTES / 1024 / 1024}MB）`)
  const data = await file.arrayBuffer()
  const rec: Rec = {
    id: `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name: fontDisplayName(file.name),
    data,
    added: Date.now(),
  }
  await register(rec) // 先确认浏览器认得这个字体，再落库
  await tx('readwrite', (s) => s.put(rec))
  const cur = allFonts().filter((f) => f.id.startsWith('custom-'))
  setCustomFonts([...cur, toOption(rec)])
  return toOption(rec)
}

export async function removeCustomFont(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
  setCustomFonts(allFonts().filter((f) => f.id.startsWith('custom-') && f.id !== id))
}

/** 订阅字体列表（导入 / 删除后下拉立刻刷新） */
export function useAllFonts(): FontOption[] {
  const [list, setList] = useState<FontOption[]>(allFonts)
  useEffect(() => {
    void loadCustomFonts()
    const on = () => setList([...allFonts()])
    window.addEventListener(FONTS_EVENT, on)
    return () => window.removeEventListener(FONTS_EVENT, on)
  }, [])
  return list
}
