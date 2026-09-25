import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { guessNovel, splitChapters } from '../core/chapters'
import {
  MAX_QUOTE,
  findIn,
  flatText,
  newCommentId,
  nodeText,
  whenOf,
  type Comment,
} from '../core/comments'

interface Props {
  title: string
  doc: JSONContent
  comments: Comment[]
  onSaveComment: (c: Comment) => void
  onRemoveComment: (id: string) => void
  onClose: () => void
}

/** 一条批注在本章正文里的落点：字符区间，坐标就是 flatText 的下标 */
interface Mark {
  id: string
  note: string
  resolved: boolean
  from: number
  to: number
}

/* ============================ 渲染：文字 + 批注切片 ============================ */

/**
 * 把 [at, at + text.length) 这段文字按批注区间切开。
 *
 * 偏移是**整章累加**的：`flatText` 把所有 text 节点直接接起来，渲染时
 * 也照同一个顺序往下传 at，所以这里的下标就是那边算出来的下标，
 * 不用再维护一张「字符 → DOM」的映射表。
 */
function sliced(text: string, at: number, marks: Mark[]): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const end = at + text.length
  const hits = marks.filter((m) => m.from < end && m.to > at).sort((a, b) => a.from - b.from)
  if (!hits.length) return [text]

  let cur = at
  for (const m of hits) {
    const s = Math.max(m.from, cur)
    const e = Math.min(m.to, end)
    if (s > cur) out.push(text.slice(cur - at, s - at))
    if (e > s) {
      out.push(
        <mark
          key={`${m.id}-${s}`}
          className={'has-comment' + (m.resolved ? ' is-resolved' : '')}
          data-comment={m.id}
          title={m.note.slice(0, 120)}
        >
          {text.slice(s - at, e - at)}
        </mark>,
      )
    }
    cur = Math.max(cur, e)
  }
  if (cur < end) out.push(text.slice(cur - at))
  return out
}

/** 把行内标记一层层包上去 —— 从里往外 */
function decorate(inner: React.ReactNode, marks?: { type: string }[]): React.ReactNode {
  let el = inner
  for (const m of marks ?? []) {
    if (m.type === 'bold') el = <strong>{el}</strong>
    else if (m.type === 'italic') el = <em>{el}</em>
    else if (m.type === 'code') el = <code>{el}</code>
    else if (m.type === 'strike') el = <s>{el}</s>
    else if (m.type === 'highlight') el = <mark>{el}</mark>
    else if (m.type === 'link') el = <u>{el}</u>
  }
  return el
}

/** 行内内容：文字 + 各种标记。标记是一层层套上去的，所以从里往外包 */
function Inline({ nodes, at, marks }: { nodes?: JSONContent[]; at: number; marks: Mark[] }) {
  const out: React.ReactNode[] = []
  let cur = at
  ;(nodes ?? []).forEach((n, i) => {
    if (n.type === 'hardBreak') {
      out.push(<br key={i} />)
      return
    }
    if (n.type !== 'text') {
      const t = nodeText(n)
      out.push(<span key={i}>{t}</span>)
      cur += t.length
      return
    }
    const t = n.text ?? ''
    const from = cur
    cur += t.length
    out.push(<span key={i}>{decorate(sliced(t, from, marks), n.marks)}</span>)
  })
  return <>{out}</>
}

/** 第 index 个子节点之前，本节点已经吃掉了多少字符 */
function offsetBefore(node: JSONContent, index: number): number {
  const kids = node.content ?? []
  let n = 0
  for (let i = 0; i < index; i += 1) n += nodeText(kids[i]).length
  return n
}

/**
 * 把一段的前 fromLine 行切掉。
 *
 * 章与章之间没有空行时，「上一章结尾 \n第N章 xxx \n作者：…」是**同一个段落**，
 * 直接渲染的话每一章开头都会挂着上一章的尾巴。软换行在文档里是 hardBreak 节点，
 * 按它数行就行。切完什么都不剩就返回 null，让调用方跳过这一块。
 *
 * 顺带把「切掉了多少字」报出来 —— 首块的字符偏移要从那儿接着数，
 * 否则这一章的批注底纹会整体串位。
 */
function cutLeadingLines(
  node: JSONContent,
  fromLine: number,
): { node: JSONContent | null; skipped: number } {
  if (fromLine <= 0) return { node, skipped: 0 }
  const out: JSONContent[] = []
  let line = 0
  let skipped = 0
  for (const child of node.content ?? []) {
    if (child.type === 'hardBreak') {
      line += 1
      continue
    }
    if (line >= fromLine) out.push(child)
    else skipped += nodeText(child).length
  }
  return { node: out.length ? { ...node, content: out } : null, skipped }
}

/**
 * 一个块。
 *
 * 这里刻意不引额外的东西：只认常见的几种，认不出来的降级成段落文本 ——
 * 阅读视图的目标是「把字读清楚」，不是把每种节点都还原得一模一样。
 * 真正的编辑仍然回编辑器里做。
 */
function Block({ node, at, marks }: { node: JSONContent; at: number; marks: Mark[] }) {
  const kids = (node.content ?? []).map((c, i) => (
    <Block key={i} node={c} at={at + offsetBefore(node, i)} marks={marks} />
  ))
  switch (node.type) {
    case 'heading': {
      const lv = Math.min(Math.max(Number(node.attrs?.level ?? 2), 2), 4)
      const Tag = (lv === 2 ? 'h2' : lv === 3 ? 'h3' : 'h4') as 'h2' | 'h3' | 'h4'
      return (
        <Tag className="reader-h">
          <Inline nodes={node.content} at={at} marks={marks} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p>
          <Inline nodes={node.content} at={at} marks={marks} />
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
          <code>{sliced(nodeText(node), at, marks)}</code>
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
          <Inline nodes={node.content} at={at} marks={marks} />
        </p>
      )
  }
}

/* ============================ 主视图 ============================ */

/**
 * 小说阅读视图：左边章节目录 / 批注，右边正文按栏排。
 *
 * 「分栏」用的是 CSS `columns` + `column-fill: auto`：给一个固定高度的容器，
 * 内容填满第一栏就自动往第二栏流，横向溢出多少就是多少屏。翻页就是把
 * 内容条横向平移一个视口宽 —— 这是电子书阅读器最常见的那套做法，
 * 不用自己算断行位置，中文英文都交给排版引擎。
 *
 * 章节**不是进门就切**：先让 guessNovel 判断这像不像小说（章节数、对白密度、
 * 篇幅一起打分），像才问一句「要按章节识别吗」。不问就切的话，
 * 一篇读书笔记也会被切得七零八落。
 *
 * 批注也在这里看得见：底纹是照 `core/comments.ts` 的引文现找的，
 * 和编辑器里是同一套定位策略 —— 两边找得到同一句话。
 */
export default function ReaderView({
  title,
  doc,
  comments,
  onSaveComment,
  onRemoveComment,
  onClose,
}: Props) {
  const guess = useMemo(() => guessNovel(doc), [doc])
  const needAsk = guess.likely
  /** null = 还没答；答过之后才决定切不切 */
  const [wantChapters, setWantChapters] = useState<boolean | null>(null)
  /** 还没答之前先不切 —— 免得弹窗还挂着，目录已经变了 */
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
  /** 翻一页要平移多少像素 —— 容器宽 + 一个栏间距 */
  const [step, setStep] = useState(0)
  const [tocOpen, setTocOpen] = useState(true)
  const [tab, setTab] = useState<'chapters' | 'notes'>('chapters')
  const [leaving, setLeaving] = useState(false)
  const viewRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const leaveRef = useRef(false)

  const chapter = chapters[Math.min(ci, chapters.length - 1)]

  /* ---------------- 批注 ---------------- */

  const text = useMemo(() => flatText(chapter.blocks), [chapter])
  const marks = useMemo<Mark[]>(
    () =>
      comments.flatMap((c) => {
        const at = findIn(text, c.quote)
        return at ? [{ id: c.id, note: c.note, resolved: c.resolved, ...at }] : []
      }),
    [comments, text],
  )
  /** 引文在本章里找不到的条数 —— 如实报出来，不当没这回事 */
  const missing = comments.length - marks.length

  const [sel, setSel] = useState<{ quote: string; x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [newText, setNewText] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const noteRef = useRef<HTMLTextAreaElement>(null)

  const effTab: 'chapters' | 'notes' = slicing ? tab : 'notes'
  const showAside = tocOpen && (slicing || comments.length > 0)

  /** 面板里面板条控制不了：选起来、算好浮条该浮在哪儿 */
  const pickSelection = useCallback(() => {
    const box = viewRef.current
    const s = window.getSelection()
    if (!box || !s || !s.rangeCount || s.isCollapsed) {
      setSel(null)
      return
    }
    const range = s.getRangeAt(0)
    if (!box.contains(range.commonAncestorContainer)) {
      setSel(null)
      return
    }
    const quote = s.toString().trim()
    if (!quote) {
      setSel(null)
      return
    }
    const r = range.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    // 靠顶的时候放下面 —— 否则浮条会被 .reader-pages 的 overflow 裁掉
    const below = r.top - b.top < 56
    setSel({
      quote: quote.slice(0, MAX_QUOTE),
      x: Math.min(Math.max(r.left + r.width / 2 - b.left, 76), Math.max(76, b.width - 76)),
      y: below ? r.bottom - b.top + 10 : r.top - b.top - 42,
    })
  }, [])

  const startNote = useCallback(() => {
    if (!sel) return
    setDraft(sel.quote)
    setTab('notes')
    setTocOpen(true)
    setSel(null)
    window.getSelection()?.removeAllRanges()
  }, [sel])

  useEffect(() => {
    if (!draft) return
    const t = window.setTimeout(() => noteRef.current?.focus(), 70)
    return () => window.clearTimeout(t)
  }, [draft])

  const submitNote = () => {
    const note = newText.trim()
    if (!note || !draft) return
    onSaveComment({ id: newCommentId(), quote: draft, note, created: Date.now(), resolved: false })
    setNewText('')
    setDraft(null)
  }

  const submitEdit = (c: Comment) => {
    const note = editText.trim()
    if (!note) return
    onSaveComment({ ...c, note })
    setEditId(null)
  }

  /**
   * 量一次：一屏有多少栏、一共多少屏。
   *
   * **步进不是容器宽**。多栏布局里，容器宽 1036 装下的是
   * 「[栏1 492][间距 52][栏2 492]」，而下一屏要从**栏3** 开始 ——
   * 那得再跨过一个间距，所以真实步进是 1036 + 52 = 1088。
   * 拿容器宽当步进的话每页少挪一个 gap，翻几页就肉眼可见地偏出去
   * （这坑实装机上踩过一次）。
   */
  const measure = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const w = track.clientWidth
    if (!w) return
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0
    const s = w + gap
    setStep(s)
    const total = Math.max(1, Math.ceil((track.scrollWidth + gap) / s))
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

  /** 关的时候先让出场动画播完再卸 —— 直接 onClose 是一帧硬切 */
  const close = useCallback(() => {
    if (leaveRef.current) return
    leaveRef.current = true
    setLeaving(true)
    window.setTimeout(onClose, 200)
  }, [onClose])

  /** 跳到某条批注所在的那一屏 */
  const jumpTo = useCallback(
    (id: string) => {
      const track = trackRef.current
      const el = track?.querySelector<HTMLElement>(`[data-comment="${id}"]`)
      if (!track || !el || !step) return
      // track 已经被平移过了，两者相减得到的是**内容坐标**，与当前页无关
      const at = el.getBoundingClientRect().left - track.getBoundingClientRect().left
      setPage(Math.max(0, Math.min(pages - 1, Math.floor(at / step))))
    },
    [step, pages],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }
      // 弹窗还挂着的时候，翻页键不该生效
      if (needAsk && wantChapters === null) return
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
        if (slicing && ci + 1 < chapters.length) setCi(ci + 1)
        return
      }
      if (e.key === '[' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (slicing && ci > 0) setCi(ci - 1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, close, ci, chapters.length, slicing, needAsk, wantChapters])

  return (
    <div className={'reader' + (leaving ? ' leaving' : '')}>
      {showAside && (
        <aside className="reader-toc">
          <div className="reader-tabs">
            {slicing && (
              <button
                className={'reader-tab' + (effTab === 'chapters' ? ' on' : '')}
                onClick={() => setTab('chapters')}
              >
                章节<span className="reader-tab-n">{chapters.length}</span>
              </button>
            )}
            <button
              className={'reader-tab' + (effTab === 'notes' ? ' on' : '')}
              onClick={() => setTab('notes')}
            >
              批注<span className="reader-tab-n">{comments.length}</span>
            </button>
          </div>

          {effTab === 'chapters' ? (
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
          ) : (
            <div className="reader-notes">
              {draft && (
                <div className="comment-new">
                  <div className="comment-quote" title={draft}>
                    {draft}
                  </div>
                  <textarea
                    ref={noteRef}
                    className="comment-input"
                    placeholder="写点什么… Ctrl+Enter 保存"
                    value={newText}
                    onChange={(e) => setNewText(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault()
                        submitNote()
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        e.stopPropagation()
                        setDraft(null)
                      }
                    }}
                  />
                  <div className="comment-actions">
                    <button className="btn primary" disabled={!newText.trim()} onClick={submitNote}>
                      保存
                    </button>
                    <button className="btn ghost" onClick={() => setDraft(null)}>
                      取消
                    </button>
                  </div>
                </div>
              )}

              {!comments.length && !draft && (
                <div className="comments-empty">
                  还没有批注。
                  <br />
                  在正文里选中一段文字，点浮出来的「批注」。
                </div>
              )}

              {missing > 0 && (
                <div className="reader-notes-miss">
                  {missing} 条批注的原文不在这一章（或已经被改掉）
                </div>
              )}

              {comments.map((c) => (
                <div key={c.id} className="comment-item">
                  <div className="comment-quote" title={c.quote} onClick={() => jumpTo(c.id)}>
                    {c.quote.length > 100 ? `${c.quote.slice(0, 100)}…` : c.quote}
                  </div>

                  {editId === c.id ? (
                    <>
                      <textarea
                        className="comment-input"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                            e.preventDefault()
                            submitEdit(c)
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            e.stopPropagation()
                            setEditId(null)
                          }
                        }}
                      />
                      <div className="comment-actions">
                        <button
                          className="btn primary"
                          disabled={!editText.trim()}
                          onClick={() => submitEdit(c)}
                        >
                          保存
                        </button>
                        <button className="btn ghost" onClick={() => setEditId(null)}>
                          取消
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="comment-note">{c.note}</div>
                      <div className="comment-foot">
                        <span className="comment-when">{whenOf(c.created)}</span>
                        <span className="grow" />
                        <button
                          className="btn ghost mini"
                          onClick={() => {
                            setEditId(c.id)
                            setEditText(c.note)
                          }}
                        >
                          改
                        </button>
                        <button className="btn ghost mini" onClick={() => onRemoveComment(c.id)}>
                          删
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </aside>
      )}

      <main className="reader-main">
        <header className="reader-bar">
          <button
            className="btn ghost icon"
            onClick={() => setTocOpen((v) => !v)}
            title={tocOpen ? '收起侧栏' : '展开侧栏'}
          >
            ☰
          </button>
          <span className="reader-now">{chapter.title}</span>
          <span className="reader-gap" />
          <span className="reader-page">
            {page + 1} / {pages}
          </span>
          <button className="btn ghost icon" onClick={close} title="退出阅读 · Esc">
            ✕
          </button>
        </header>

        <div className="reader-pages" ref={viewRef} onMouseUp={pickSelection}>
          {sel && (
            <div className="reader-sel" style={{ left: sel.x, top: sel.y }}>
              <button className="btn mini" onMouseDown={(e) => e.preventDefault()} onClick={startNote}>
                ❝ 批注
              </button>
            </div>
          )}

          {/* key 跟着章走：换章时让这一条**重新挂载**，
              位移就回到 0 而不是从上一章的偏移滑回来；进场动画顺带把
              「换了一章」这件事说清楚。翻页不换 ci，所以不会误播。 */}
          <div
            key={ci}
            className="reader-track"
            ref={trackRef}
            style={{ transform: `translateX(-${page * step}px)` }}
          >
            {chapter.blocks.map((b, i) => {
              // 首块可能要裁掉属于上一章的那几行
              const cut = i === 0 ? cutLeadingLines(b, chapter.line) : { node: b, skipped: 0 }
              return cut.node ? (
                <Block key={i} node={cut.node} at={cut.skipped} marks={marks} />
              ) : null
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
            {slicing ? '← → 翻页 · [ ] 换章 · 选中加批注 · Esc 退出' : '← → 翻页 · Esc 退出'}
          </span>
        </footer>
      </main>

      {/* 像不像小说由 guessNovel 打分，这里只负责把「凭什么」摊开问一句。
          做成居中弹窗而不是顶上挂一条：这件事得先答完，页面才算真的开始。 */}
      {needAsk && wantChapters === null && (
        <div className="reader-mask">
          <div className="reader-ask" role="dialog" aria-modal="true">
            <div className="reader-ask-mark">▤</div>
            <div className="reader-ask-title">这看着像一篇小说</div>
            <div className="reader-ask-sub">要不要按章节切开？切开之后左边就有目录，可以跳章读。</div>
            <ul className="reader-ask-why">
              {guess.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <div className="reader-ask-acts">
              <button
                className="btn ghost"
                onClick={() => {
                  setWantChapters(false)
                  setTab('notes')
                }}
              >
                整篇读
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  setWantChapters(true)
                  setTab('chapters')
                }}
              >
                按章节读
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
