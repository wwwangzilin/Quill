import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { guessNovel, splitChapters } from '../core/chapters'

interface Props {
  title: string
  doc: JSONContent
  onClose: () => void
}

/** 行内内容：文字 + 各种标记。标记是一层层套上去的，所以从里往外包 */
function Inline({ nodes }: { nodes?: JSONContent[] }) {
  return (
    <>
      {(nodes ?? []).map((n, i) => {
        if (n.type === 'hardBreak') return <br key={i} />
        if (n.type !== 'text') return <span key={i}>{plain(n)}</span>
        let el: React.ReactNode = n.text ?? ''
        for (const m of n.marks ?? []) {
          if (m.type === 'bold') el = <strong>{el}</strong>
          else if (m.type === 'italic') el = <em>{el}</em>
          else if (m.type === 'code') el = <code>{el}</code>
          else if (m.type === 'strike') el = <s>{el}</s>
          else if (m.type === 'highlight') el = <mark>{el}</mark>
          else if (m.type === 'link') el = <u>{el}</u>
        }
        return <span key={i}>{el}</span>
      })}
    </>
  )
}

function plain(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(plain).join('')
}

/**
 * 把一段的前 fromLine 行切掉。
 *
 * 章与章之间没有空行时，「上一章结尾 \n第N章 xxx \n作者：…」是**同一个段落**，
 * 直接渲染的话每一章开头都会挂着上一章的尾巴。软换行在文档里是 hardBreak 节点，
 * 按它数行就行。切完什么都不剩就返回 null，让调用方跳过这一块。
 */
function cutLeadingLines(node: JSONContent, fromLine: number): JSONContent | null {
  if (fromLine <= 0) return node
  const out: JSONContent[] = []
  let line = 0
  for (const child of node.content ?? []) {
    if (child.type === 'hardBreak') {
      line += 1
      continue
    }
    if (line >= fromLine) out.push(child)
  }
  return out.length ? { ...node, content: out } : null
}

/**
 * 一个块。
 *
 * 这里刻意不引额外的东西：只认常见的几种，认不出来的降级成段落文本 ——
 * 阅读视图的目标是「把字读清楚」，不是把每种节点都还原得一模一样。
 * 真正的编辑仍然回编辑器里做。
 */
function Block({ node }: { node: JSONContent }) {
  const kids = (node.content ?? []).map((c, i) => <Block key={i} node={c} />)
  switch (node.type) {
    case 'heading': {
      const lv = Math.min(Math.max(Number(node.attrs?.level ?? 2), 2), 4)
      const Tag = (lv === 2 ? 'h2' : lv === 3 ? 'h3' : 'h4') as 'h2' | 'h3' | 'h4'
      return (
        <Tag className="reader-h">
          <Inline nodes={node.content} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p>
          <Inline nodes={node.content} />
        </p>
      )
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
    case 'image':
      return (
        <img
          className="reader-img"
          src={String(node.attrs?.src ?? '')}
          alt={String(node.attrs?.alt ?? '')}
        />
      )
    default:
      return (
        <p>
          <Inline nodes={node.content} />
        </p>
      )
  }
}

/**
 * 小说阅读视图：左边章节目录，右边正文按栏排。
 *
 * 「分栏」用的是 CSS `columns` + `column-fill: auto`：给一个固定高度的容器，
 * 内容填满第一栏就自动往第二栏流，横向溢出多少就是多少屏。翻页就是把
 * 内容条横向平移一个视口宽 —— 这是电子书阅读器最常见的那套做法，
 * 不用自己算断行位置，中文英文都交给排版引擎。
 *
 * 章节**不是进门就切**：先让 guessNovel 判断这像不像小说（章节数、对白密度、
 * 篇幅一起打分），像才问一句「要按章节识别吗」。不问就切的话，
 * 一篇读书笔记也会被切得七零八落。
 */
export default function ReaderView({ title, doc, onClose }: Props) {
  const guess = useMemo(() => guessNovel(doc), [doc])
  const needAsk = guess.likely
  /** null = 还没答；答过之后才决定切不切 */
  const [wantChapters, setWantChapters] = useState<boolean | null>(null)
  /** 还没答之前先不切 —— 免得提示条还挂着，目录已经变了 */
  const slicing = wantChapters === true

  const chapters = useMemo(
    () =>
      slicing
        ? splitChapters(doc, title)
        : [
            {
              title,
              level: 1,
              start: 0,
              line: 0,
              inferred: false,
              blocks: doc.content ?? [],
            },
          ],
    [doc, title, slicing],
  )
  const [ci, setCi] = useState(0)
  const [page, setPage] = useState(0)
  const [pages, setPages] = useState(1)
  const [tocOpen, setTocOpen] = useState(true)
  const viewRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  const chapter = chapters[Math.min(ci, chapters.length - 1)]

  /**
   * 量一次：内容条总宽 ÷ 它的自身宽 = 有多少屏。
   *
   * **必须用 track 自己的 clientWidth**，不能用外层 .reader-pages 的 ——
   * 外层带着左右各 44px 的 padding，拿它当一屏会每页多挪 88px，
   * 翻着翻着就偏出去了（这坑实装过一次）。
   */
  const measure = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const w = track.clientWidth
    if (!w) return
    const total = Math.max(1, Math.ceil(track.scrollWidth / w))
    setPages(total)
    setPage((p) => Math.min(p, total - 1))
  }, [])

  // 换章、窗口缩放、字体变化都要重新量 —— 栏宽一变，页数就变了
  useEffect(() => {
    measure()
    const view = viewRef.current
    if (!view || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(view)
    return () => ro.disconnect()
  }, [measure, ci])

  // 换章回到第一屏
  useEffect(() => {
    setPage(0)
  }, [ci])

  const go = useCallback(
    (delta: number) => {
      setPage((p) => {
        const next = p + delta
        if (next >= 0 && next < pages) return next
        // 翻过头就换章，接着读不用自己找按钮
        if (next >= pages && ci + 1 < chapters.length) {
          setCi(ci + 1)
          return 0
        }
        if (next < 0 && ci > 0) {
          setCi(ci - 1)
          return 0
        }
        return p
      })
    },
    [pages, ci, chapters.length],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        go(1)
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        go(-1)
        return
      }
      if (e.key === ']' || e.key === 'ArrowDown') {
        e.preventDefault()
        if (ci + 1 < chapters.length) setCi(ci + 1)
        return
      }
      if (e.key === '[' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (ci > 0) setCi(ci - 1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, onClose, ci, chapters.length])

  return (
    <div className="reader">
      {slicing && tocOpen && (
        <aside className="reader-toc">
          <div className="reader-toc-head">
            章节目录
            <span className="reader-toc-count">{chapters.length} 章</span>
          </div>
          <div className="reader-toc-list">
            {chapters.map((c, i) => (
              <button
                key={`${c.start}-${i}`}
                className={'reader-toc-item' + (i === ci ? ' on' : '')}
                onClick={() => setCi(i)}
                title={c.inferred ? '这一章是从「第X章」这类文字里认出来的' : c.title}
              >
                <span className="reader-toc-n">{i + 1}</span>
                <span className="reader-toc-title">{c.title}</span>
              </button>
            ))}
          </div>
        </aside>
      )}

      <main className="reader-main">
        <header className="reader-bar">
          {slicing && (
            <button
              className="btn ghost icon"
              onClick={() => setTocOpen((v) => !v)}
              title={tocOpen ? '收起目录' : '展开目录'}
            >
              ☰
            </button>
          )}
          <span className="reader-now">{chapter.title}</span>
          <span className="reader-gap" />
          <span className="reader-page">
            {page + 1} / {pages}
          </span>
          <button className="btn ghost icon" onClick={onClose} title="退出阅读 · Esc">
            ✕
          </button>
        </header>

        {/* 先判断像不像小说，像才问这一句。
            判断依据直接摊开写，别让用户被一个黑盒弹窗拦住。 */}
        {needAsk && wantChapters === null && (
          <div className="reader-ask">
            <span>
              这篇看着像小说（{guess.reasons.join(' · ')}）—— 要按章节识别吗？
            </span>
            <button className="btn primary" onClick={() => setWantChapters(true)}>
              识别章节
            </button>
            <button className="btn" onClick={() => setWantChapters(false)}>
              整篇读
            </button>
          </div>
        )}

        <div className="reader-pages" ref={viewRef}>
          {/* 位移用**自身宽度的百分比**：track 的宽正好是一屏可见的内容宽，
              所以 -100% 就是一页。不再去读 clientWidth 现算 —— 那个值含 padding，
              而且渲染时读到的是上一轮布局（目录展开前后宽度还不一样）。 */}
          <div
            className="reader-track"
            ref={trackRef}
            style={{ transform: `translateX(-${page * 100}%)` }}
          >
            {chapter.blocks.map((b, i) => {
              // 首块可能要裁掉属于上一章的那几行
              const node = i === 0 ? cutLeadingLines(b, chapter.line) : b
              return node ? <Block key={i} node={node} /> : null
            })}
          </div>
        </div>

        <footer className="reader-foot">
          <button className="btn" disabled={!slicing || ci === 0} onClick={() => setCi(ci - 1)}>
            上一章
          </button>
          <span className="reader-pos">
            {slicing ? `第 ${ci + 1} / ${chapters.length} 章` : '整篇'}
          </span>
          <button
            className="btn"
            disabled={!slicing || ci + 1 >= chapters.length}
            onClick={() => setCi(ci + 1)}
          >
            下一章
          </button>
          <span className="reader-gap" />
          <span className="reader-hint">
            {slicing ? '← → 翻页 · [ ] 换章 · Esc 退出' : '← → 翻页 · Esc 退出'}
          </span>
        </footer>
      </main>
    </div>
  )
}
