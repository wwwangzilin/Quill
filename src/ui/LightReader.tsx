import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { parseDocument } from '../core/md-parse'
import type { RawChapter } from '../core/rawChapters'
import { readPos, writePos } from '../core/lastPos'
import { storage } from '../core/storage'

interface Props {
  docId: string
  title: string
  onClose: () => void
}

function plain(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  return (node.content ?? []).map(plain).join('')
}

/**
 * 只读用的极简块渲染。
 *
 * 刻意不引 ReaderView 那一套（行内标记、批注底纹）：那是给「正常文档」准备的，
 * 而这里的每一章都要现解析现渲染，越薄越好。小说正文九成是段落，够读了。
 */
function Block({ node }: { node: JSONContent }) {
  const kids = (node.content ?? []).map((c, i) => <Block key={i} node={c} />)
  switch (node.type) {
    case 'heading':
      return <h3 className="reader-h">{plain(node)}</h3>
    case 'paragraph':
      return <p>{plain(node)}</p>
    case 'blockquote':
      return <blockquote>{kids}</blockquote>
    case 'bulletList':
      return <ul>{kids}</ul>
    case 'orderedList':
      return <ol>{kids}</ol>
    case 'listItem':
      return <li>{kids}</li>
    case 'codeBlock':
      return (
        <pre>
          <code>{plain(node)}</code>
        </pre>
      )
    case 'horizontalRule':
      return <hr />
    default:
      return <p>{plain(node)}</p>
  }
}

/**
 * 把「单换行分段」补齐成空行。
 *
 * 从网页扒来的小说几乎都是单换行分段，而 Markdown 要空行才认段落 ——
 * 不补的话整章会挤成一个巨型段落（实测 700 万字那篇，一章 6 万字出来只有
 * 一个块）。只对当前这一章跑，几万字符，很快。
 */
function softWrapToParagraphs(md: string): string {
  return md.replace(/([^\n])\n(?!\n)/g, '$1\n\n')
}

/**
 * 轻量阅读器：给「几百万字」那种文档用的。
 *
 * **既不进 ProseMirror，也不把全文搬进前端**：
 *
 *   · 章节目录由 Rust 侧流式扫出来（只回几百个小对象），原文那 21MB
 *     一次都不经过 IPC —— 转一趟还要 JSON 转义，纯属浪费；
 *   · 正文按需取：翻到哪章才读哪一段（几十 KB），解析不到 1ms。
 *
 * **只读**，不给编辑留口子。编辑器一旦「只加载一半」，保存时就会把另一半
 * 截掉 —— 那是不可逆的损坏。想编辑请先把文档拆开。
 */
export default function LightReader({ docId, title, onClose }: Props) {
  const [chapters, setChapters] = useState<RawChapter[]>([])
  const [blocks, setBlocks] = useState<JSONContent[]>([])
  const [loading, setLoading] = useState(true)
  const [ci, setCi] = useState(0)
  /** 恢复上次读到哪一章时，等目录回来再定位，所以先记着 */
  const wantChapter = useRef<string | null>(null)
  const restored = useRef(false)

  // ① 章节目录：Rust 侧扫，不搬正文
  useEffect(() => {
    let alive = true
    setLoading(true)
    void storage
      .outline?.(docId)
      .then((o) => {
        if (!alive) return
        const marks = o?.marks ?? []
        setChapters(marks)
        // 上次读到哪一章 —— 目录回来之后才认得出来
        const p = readPos(docId)
        if (!restored.current && p?.chapter) {
          restored.current = true
          const i = marks.findIndex((c) => c.title === p.chapter)
          if (i > 0) setCi(i)
        }
      })
      .catch(() => {
        if (alive) setChapters([])
      })
    return () => {
      alive = false
    }
  }, [docId])

  const ch = chapters[Math.min(ci, chapters.length - 1)]

  // ② 正文：只取当前这一章那一段
  useEffect(() => {
    if (!ch) {
      setBlocks([])
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    void storage
      .readSlice?.(docId, ch.from, ch.to)
      .then((seg) => {
        if (!alive) return
        setBlocks(parseDocument(softWrapToParagraphs(seg ?? '')).doc.content ?? [])
      })
      .catch(() => {
        if (alive) setBlocks([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [docId, ch])

  const go = useCallback(
    (delta: number) => {
      setCi((i) => Math.max(0, Math.min(chapters.length - 1, i + delta)))
    },
    [chapters.length],
  )

  // 换章回到顶部，并记一笔
  useEffect(() => {
    document.querySelector('.light-reader .light-body')?.scrollTo({ top: 0 })
    if (ch) writePos(docId, { chapter: ch.title, page: 0 })
  }, [ci, ch, docId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === ']' || e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault()
        go(1)
        return
      }
      if (e.key === '[' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        go(-1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, onClose])

  return (
    <div className="light-reader">
      <header className="light-bar">
        <span className="light-tag">轻量阅读</span>
        <span className="light-title">{title}</span>
        <span className="reader-gap" />
        <span className="light-count">
          {chapters.length > 1 ? `第 ${ci + 1} / ${chapters.length} 章` : '整篇'}
        </span>
        <button className="btn ghost icon" onClick={onClose} title="退出 · Esc">
          ✕
        </button>
      </header>

      <div className="light-body">
        {loading && !blocks.length ? (
          <div className="light-loading">正在取这一章…</div>
        ) : (
          <article className="light-article">
            {blocks.map((b, i) => (
              <Block key={i} node={b} />
            ))}
          </article>
        )}
      </div>

      <footer className="light-foot">
        <button className="btn" disabled={ci === 0} onClick={() => go(-1)}>
          上一章
        </button>
        <button className="btn" disabled={ci + 1 >= chapters.length} onClick={() => go(1)}>
          下一章
        </button>
        <span className="reader-gap" />
        <span className="reader-hint">
          {chapters.length > 1 ? '[ ] 换章 · Esc 退出 · 只读' : 'Esc 退出 · 只读'}
        </span>
      </footer>
    </div>
  )
}
