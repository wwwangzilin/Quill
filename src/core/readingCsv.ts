/**
 * 阅读记录导出成 CSV（Excel / Numbers / 表格软件直接能开）。
 * 带 UTF-8 BOM，不然 Excel 会把中文当乱码；字段按 RFC 4180 转义。
 */
import { dayKey } from './readStats.ts'

export interface ReadingRow {
  title: string
  /** 读到的章节（没有就空） */
  chapter?: string
  /** 累计阅读秒数 */
  secs: number
  first?: number
  last?: number
  done?: number
  comments: number
  bookmarks: number
  /** 书架状态的中文名 */
  status?: string
}

const esc = (v: string | number) => {
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 防 CSV 注入：以 = + - @ 开头的文本，Excel 会当公式执行，前面补一个单引号 */
const safe = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s)

const day = (ts?: number) => (ts ? dayKey(ts) : '')
const mins = (secs: number) => Math.round(secs / 60)

export const CSV_HEADER = ['书名', '状态', '读到章节', '累计分钟', '首次阅读', '最近阅读', '读完日期', '批注数', '书签数']

export function readingCsv(rows: ReadingRow[]): string {
  const lines = [CSV_HEADER.map(esc).join(',')]
  for (const r of rows) {
    lines.push(
      [
        safe(r.title || '未命名'),
        r.status ?? '',
        safe(r.chapter ?? ''),
        mins(r.secs),
        day(r.first),
        day(r.last),
        day(r.done),
        r.comments,
        r.bookmarks,
      ]
        .map(esc)
        .join(','),
    )
  }
  return '﻿' + lines.join('\r\n') + '\r\n'
}
