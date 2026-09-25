import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { parseDocument } from '../core/md-parse'
import { splitRawChapters } from '../core/rawChapters'
import { readPos, writePos } from '../core/lastPos'

interface Props {
  docId: string
  title: string
  /** 原文 Markdown —— 注意这里收的是字符串，不是解析好的 JSON */
  raw: string
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
 * **不走 ProseMirror，也不把全文解析成 JSONContent** —— 700 万字光解析就是
 * 二十多万个块，那一步就够卡死，而阅读根本不需要它。这里只在原文上扫一遍
 * 章节边界（实测 17ms），然后**按需**解析当前这一章：一章几万字，
 * 不到 1ms，翻到哪章算哪章。
 *
 * **只读**，不给编辑留口子。编辑器一旦「只加载一半」，保存时就会把另一半
 * 截掉 —— 那是不可逆的损坏。想编辑请先把文档拆开。
 */
export default function LightReader({ docId, title, raw, onClose }: Props) {
  // 切章只扫一遍原文，不建对象图；只在 raw 变了才重算
  const chapters = useMemo(() => splitRawChapters(raw, title), [raw, title])
  const [ci, setCi] = useState(() => {
    const p = readPos(docId)
    if (!p?.chapter) return 0
    const i = chapters.findIndex((c) => c.title === p.chapter)
    return i > 0 ? i : 0
  })

  const ch = chapters[Math.min(ci, chapters.length - 1)]

  /** 当前章的正文 —— 只有它被解析，而且是这一章才几十 KB */
  const blocks = useMemo(() => {
    if (!ch) return []
    const seg = softWrapToParagraphs(raw.slice(ch.from, ch.to))
    return parseDocument(seg).doc.content ?? []
  }, [raw, ch])

  const go = useCallback(
    (delta: number) => {
      setCi((i) => Math.max(0, Math.min(chapters.length - 1, i + delta)))
    },
    [chapters.length],
  )

  // 换章回到顶部
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
        <article className="light-article">
          {blocks.map((b, i) => (
            <Block key={i} node={b} />
          ))}
        </article>
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
