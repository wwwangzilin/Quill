import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { guessNovel, splitChapters, type NovelGuess } from '../core/chapters'
import { MAX_QUOTE, blockOffsets, findIn, flatText, nodeText, type Comment } from '../core/comments'
import { posLabel, readPos, writePos } from '../core/lastPos'
import type { RawChapter } from '../core/rawChapters'
import { parseDocument } from '../core/md-parse'
import { storage } from '../core/storage'
import CommentsPanel from './CommentsPanel'
import { toast } from './toast'

interface Props {
  /** 用到哪篇 —— 上次读到哪一屏是按文档记的 */
  docId: string
  title: string
  /**
   * 正常文档：解析好的内容。
   * 超大文档**不给这个**，只给下面的 `outline` —— 那篇根本解析不起。
   */
  doc?: JSONContent
  /**
   * 超大文档的章节目录（Rust 侧流式扫出来的）。
   *
   * 给了它就**不解析全文**：目录从这儿来，正文翻到哪章现取哪一段。
   * 关键是 —— 它走的还是**这一个组件**，所以左边目录、双栏排版、翻页、
   * 批注底纹、进出动画全都跟普通小说一模一样。
   * （上一版我另写了个 LightReader，界面跟这儿对不上，主人一眼就看出来了。）
   */
  outline?: RawChapter[]
  comments: Comment[]
  onSaveComment: (c: Comment) => void
  onRemoveComment: (id: string) => void
  onClose: () => void
}

/**
 * 一条批注在本章正文里的落点：字符区间。
 * 坐标就是 `flatText(chapter.blocks)` 的下标，渲染时靠 `blockOffsets` 对齐。
 * （改这里只为碰一下文件让 Vite 重编 —— 见 README 的排查记录。）
 */
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
function sliced(
  text: string,
  at: number,
  marks: Mark[],
  onPick?: (id: string) => void,
): React.ReactNode[] {
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
          onClick={onPick ? () => onPick(m.id) : undefined}
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
function Inline({
  nodes,
  at,
  marks,
  onPick,
}: {
  nodes?: JSONContent[]
  at: number
  marks: Mark[]
  onPick?: (id: string) => void
}) {
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
    out.push(<span key={i}>{decorate(sliced(t, from, marks, onPick), n.marks)}</span>)
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
function Block({
  node,
  at,
  marks,
  onPick,
}: {
  node: JSONContent
  at: number
  marks: Mark[]
  onPick?: (id: string) => void
}) {
  const kids = (node.content ?? []).map((c, i) => (
    <Block key={i} node={c} at={at + offsetBefore(node, i)} marks={marks} onPick={onPick} />
  ))
  switch (node.type) {
    case 'heading': {
      const lv = Math.min(Math.max(Number(node.attrs?.level ?? 2), 2), 4)
      const Tag = (lv === 2 ? 'h2' : lv === 3 ? 'h3' : 'h4') as 'h2' | 'h3' | 'h4'
      return (
        <Tag className="reader-h">
          <Inline nodes={node.content} at={at} marks={marks} onPick={onPick} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p>
          <Inline nodes={node.content} at={at} marks={marks} onPick={onPick} />
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
          <code>{sliced(nodeText(node), at, marks, onPick)}</code>
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
          <Inline nodes={node.content} at={at} marks={marks} onPick={onPick} />
        </p>
      )
  }
}

/* ============================ 主视图 ============================ */

/**
 * 小说阅读视图：左边章节目录，右边正文按栏排。
 *
 * 「分栏」用的是 CSS `columns` + `column-fill: auto`：给一个固定高度的容器，
 * 内容填满第一栏就自动往第二栏流，横向溢出多少就是多少屏。翻页就是把
 * 内容条横向平移一个视口宽 —— 这是电子书阅读器最常见的那套做法，
 * 不用自己算断行位置，中文英文都交给排版引擎。
 *
 * 章节**不自动切**：先让 guessNovel 判断这像不像小说，像就在右下角浮一条提示，
 * 点一下直接进分章模式。默认整篇读 —— 一篇读书笔记被硬切成章节只会更碎，
 * 但也不该拿一个确认框把人拦在门口。
 *
 * 批注走的是和编辑器**同一套东西**：`core/comments.ts` 的定位、
 * `CommentsPanel` 抽屉、`.ai-sel` 浮条、`.has-comment` 底纹。
 * 手感不一致通常不是审美问题，是「另起了一套」。
 */
/**
 * 把「单换行分段」补齐成空行。
 *
 * 从网页扒来的小说几乎都是单换行分段，而 Markdown 要空行才认段落 ——
 * 不补的话整章会挤成一个巨型段落（实测 700 万字那篇，一章 6 万字出来只有一个块）。
 * 只对当前这一章跑，几万字符，很快。
 */
function softWrapToParagraphs(md: string): string {
  return md.replace(/([^\n])\n(?!\n)/g, '$1\n\n')
}

export default function ReaderView({
  docId,
  title,
  doc,
  outline,
  comments,
  onSaveComment,
  onRemoveComment,
  onClose,
}: Props) {
  /** 超大文档：只有目录，正文按章现取 */
  const heavy = Boolean(outline?.length)

  const guess = useMemo<NovelGuess>(
    () =>
      doc
        ? guessNovel(doc)
        : {
            likely: false,
            score: 0,
            chars: 0,
            chapters: outline?.length ?? 0,
            dialogue: 0,
            reasons: [],
          },
    [doc, outline],
  )
  /**
   * 是小说就**直接分章**，不做选择题。
   *
   * 像系统更新的提示那样：事情已经替你做了，右下角知会一声就完事；
   * 判断依据收进 toast 的 detail，想反悔，工具条上留着一个开关。
   * 以前那版要人先点一下「按章节读」才算数 —— 识别都识别出来了，
   * 还把决定权推回来，等于白识别。
   */
  const [slicedOn, setSlicedOn] = useState(heavy || guess.likely)
  const slicing = slicedOn
  /** 知会只发一次：进来时判成什么就说什么，别每次重渲染又弹一条 */
  const announced = useRef(false)

  useEffect(() => {
    if (announced.current || heavy || !guess.likely) return
    announced.current = true
    toast.info(
      `已按章节识别 · ${guess.chapters} 章`,
      `${guess.reasons.join(' · ')} · 工具条上可以切回整篇读`,
    )
  }, [heavy, guess.likely, guess.chapters, guess.reasons])

  const chapters = useMemo(() => {
    // 超大文档：目录是 Rust 给的，这里不再碰正文
    if (heavy && outline) {
      return outline.map((c, i) => ({
        title: c.title || `第 ${i + 1} 节`,
        level: 2,
        start: i,
        line: 0,
        inferred: true,
        blocks: [] as JSONContent[],
      }))
    }
    if (!doc) return []
    return slicing
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
        ]
  }, [heavy, outline, doc, title, slicing])
  const [ci, setCi] = useState(0)
  const [page, setPage] = useState(0)
  const [pages, setPages] = useState(1)
  /** 翻一页要平移多少像素 —— 容器宽 + 一个栏间距 */
  const [step, setStep] = useState(0)
  const [tocOpen, setTocOpen] = useState(true)
  const [leaving, setLeaving] = useState(false)
  const viewRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const leaveRef = useRef(false)
  /**
   * 「要回到的那一屏」。页数得等 measure 量完才知道，直接 setPage 会被
   * `Math.min(p, total - 1)` 夹掉，所以先存着，量完再兑现。
   */
  const wantPage = useRef<number | null>(null)
  const restored = useRef(false)
  /** 刚恢复过来的那一次，别把页号复位成 0 */
  const skipReset = useRef(false)

  const chapter = chapters[Math.min(ci, chapters.length - 1)]

  /**
   * 这一章要显示的内容。
   *
   * 普通文档用解析好的；超大文档只把**当前这一章**取回来再解析 ——
   * 一章中位几千字，不到 1ms。全文一个字都不搬。
   */
  const [heavyBlocks, setHeavyBlocks] = useState<JSONContent[]>([])
  const [loadingBlocks, setLoadingBlocks] = useState(false)

  useEffect(() => {
    if (!heavy || !outline) return
    const seg = outline[Math.min(ci, outline.length - 1)]
    if (!seg) return
    let alive = true
    setLoadingBlocks(true)
    void storage
      .readSlice?.(docId, seg.from, seg.to)
      .then((raw) => {
        if (!alive) return
        // 扒来的小说是单换行分段，Markdown 不认 —— 不补就是一个巨型段落
        setHeavyBlocks(parseDocument(softWrapToParagraphs(raw ?? '')).doc.content ?? [])
      })
      .catch(() => {
        if (alive) setHeavyBlocks([])
      })
      .finally(() => {
        if (alive) setLoadingBlocks(false)
      })
    return () => {
      alive = false
    }
  }, [heavy, outline, docId, ci])

  const blocks = heavy ? heavyBlocks : (chapter?.blocks ?? [])

  /* ---------------- 批注 ---------------- */

  const text = useMemo(() => flatText(blocks), [blocks])
  /** 每个顶层块的起始下标 —— 少了这个，第二块之后的批注全都切不准 */
  const offsets = useMemo(() => blockOffsets(blocks), [blocks])
  const marks = useMemo<Mark[]>(
    () =>
      comments.flatMap((c) => {
        const at = findIn(text, c.quote)
        return at ? [{ id: c.id, note: c.note, resolved: c.resolved, ...at }] : []
      }),
    [comments, text],
  )

  const [sel, setSel] = useState<{ quote: string; x: number; y: number; flip: boolean } | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)

  /**
   * 选中一段 → 记下引文和浮条该浮在哪儿。
   *
   * 位置算法跟编辑器里的 AiSelectionBar 一模一样（选区中心、上边留 8px、
   * 贴顶就翻到下面），这样同一条浮条在两个界面里落点一致。
   */
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
    const topY = r.top - b.top
    const flip = topY < 64
    setSel({
      quote: quote.slice(0, MAX_QUOTE),
      x: Math.min(Math.max(r.left + r.width / 2 - b.left, 96), Math.max(96, b.width - 96)),
      y: flip ? r.bottom - b.top : topY,
      flip,
    })
  }, [])

  const startNote = useCallback(() => {
    if (!sel) return
    setDraft(sel.quote)
    setNotesOpen(true)
    setSel(null)
    window.getSelection()?.removeAllRanges()
  }, [sel])

  /** 点正文里的底纹 → 开抽屉并滚到那一条 */
  const pickMark = useCallback((id: string) => {
    setFocusId(id)
    setNotesOpen(true)
  }, [])

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
    // 有「要回到的那一屏」就先兑现，否则只是把当前页夹进新范围
    const want = wantPage.current
    if (want !== null) {
      wantPage.current = null
      setPage(Math.max(0, Math.min(want, total - 1)))
    } else {
      setPage((p) => Math.min(p, total - 1))
    }
  }, [])

  /*
   * 换章、窗口缩放、字体变化都要重新量 —— 栏宽一变，页数就变了。
   *
   * ⚠️ 依赖里必须带上 blockCount：超大文档的正文是**异步**取回来的
   * （先挂空壳、正文随后到），只认 ci 的话第一次打开量的是一具空壳 ——
   * 页数锁死在「1 / 1」，这一章后面几万字压根翻不到（实装机上踩过）。
   * 用 length 而不是 blocks 本身：非重载分支的 `?? []` 每次渲染都是新数组，
   * 直接把 blocks 放进依赖会转成死循环。
   */
  const blockCount = blocks.length
  useEffect(() => {
    measure()
    // 落定后再补一次：content-visibility 的占位尺寸要等一帧才准
    const t = window.setTimeout(measure, 160)
    const view = viewRef.current
    let ro: ResizeObserver | null = null
    if (view && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure)
      ro.observe(view)
    }
    return () => {
      window.clearTimeout(t)
      ro?.disconnect()
    }
  }, [measure, ci, blockCount])

  /*
   * 换章回到第一屏。
   * 「刚恢复过来」的那一次必须让路 —— measure 已经把页号兑现了，
   * 这里再抹一次就白恢复了（实装机上踩过：章回去了，屏还停在第 1 屏）。
   * 守卫不能用 wantPage：measure 兑现时会把它清成 null，那时它已经分不清
   * 「本来就没有」和「刚用完」了。
   */
  useEffect(() => {
    if (skipReset.current) {
      skipReset.current = false
      return
    }
    setPage(0)
  }, [ci])

  /**
   * 上次读到哪儿。
   *
   * 章按**标题**找，不按序号 —— 中间插一章、或者识别结果变了一点，
   * 序号就全错位了，照着序号跳会跳到八竿子打不着的地方。
   * 标题对不上就退回「第几屏」，再对不上就当没这回事。
   */
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    const p = readPos(docId)
    if (!p) return
    const idx = p.chapter ? chapters.findIndex((c) => c.title === p.chapter) : -1
    const want = p.page ?? 0
    // 没章号也没翻过页 —— 那就是停在开头，没什么好问的
    if (idx <= 0 && want === 0) return

    const jump = () => {
      if (idx > 0) {
        wantPage.current = want
        skipReset.current = true
        setCi(idx)
      } else {
        // 本来就是第 1 章：setCi 不会触发任何 effect，催一次 measure 兑现页号
        wantPage.current = want
        measure()
      }
    }

    /*
     * 问一句，**不自动跳**。人可能就是想从头读；
     * 而且不给按键提示 —— 不是每副键盘都有 Home 键，直接给按钮更省事。
     */
    toast.ask('上次读到这儿', posLabel(p), [
      { label: '跳过去', primary: true, run: jump },
      { label: '从头读', run: () => {} },
    ])
    // 只跑一次：chapters 是挂载时就算好的（该分章的话已经分好了）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 翻页 / 换章都记一笔。localStorage 写入很便宜，不用节流
  useEffect(() => {
    // 还在等「回到某一屏」兑现的时候别写 —— 那会儿 page 还是 0，
    // 写下去就把刚要恢复的位置冲掉了
    if (!restored.current || wantPage.current !== null) return
    writePos(docId, {
      chapter: slicing ? chapter.title : undefined,
      page,
    })
  }, [docId, slicing, chapter, page])

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
      if (!el) {
        toast.info('这条批注不在这一章', '可能是引文改动了，或者它在别的章节里')
        return
      }
      if (!track || !step) return
      // track 已经被平移过了，两者相减得到的是**内容坐标**，与当前页无关
      const at = el.getBoundingClientRect().left - track.getBoundingClientRect().left
      setPage(Math.max(0, Math.min(pages - 1, Math.floor(at / step))))
    },
    [step, pages],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 抽屉开着的时候，Esc 先收抽屉
      if (e.key === 'Escape' && notesOpen) {
        e.preventDefault()
        setNotesOpen(false)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
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
  }, [go, close, ci, chapters.length, slicing, notesOpen])

  return (
    <div className={'reader' + (leaving ? ' leaving' : '')}>
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
          {/* 反悔的入口。提示只说「做了什么」，切换收在这一个开关上，不占视线 */}
          {guess.chapters >= 3 && (
            <button
              className="btn ghost"
              onClick={() => {
                setSlicedOn((v) => !v)
                setCi(0)
                setPage(0)
              }}
              title={slicing ? '不按章节，整篇连着读' : '按章节切开，用目录跳章'}
            >
              {slicing ? '整篇读' : '按章节读'}
            </button>
          )}
          <span className="reader-now">{chapter.title}</span>
          <span className="reader-gap" />
          <span className="reader-page">
            {page + 1} / {pages}
          </span>
          <button
            className={'btn ghost icon' + (notesOpen ? ' on' : '')}
            onClick={() => setNotesOpen((v) => !v)}
            title={comments.length ? `批注 · ${comments.length} 条` : '批注 · 选中文字后加'}
          >
            ❝
          </button>
          <button className="btn ghost icon" onClick={close} title="退出阅读 · Esc">
            ✕
          </button>
        </header>

        <div className="reader-pages" ref={viewRef} onMouseUp={pickSelection}>
          {/* 超大文档：这一章还在取的路上 */}
          {heavy && loadingBlocks && !blocks.length && (
            <div className="reader-loading">正在取这一章…</div>
          )}
          {/* 浮条直接用编辑器那一套 .ai-sel：同样的结构、同样的定位、
              同样的出现动画。手感不一致往往就是「另起了一套」造成的。 */}
          {sel && (
            <div
              className={'ai-sel reader-sel' + (sel.flip ? ' flip' : '')}
              style={{ left: `${sel.x}px`, top: `${sel.y}px` }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <div className="ai-sel-row">
                <span className="ai-sel-tag">批注</span>
                <button className="ai-sel-btn" onClick={startNote}>
                  ＋ 加批注
                </button>
              </div>
            </div>
          )}

          {/* key 跟着章走：换章时让这一条**重新挂载**，
              位移就回到 0 而不是从上一章的偏移滑回来；进场动画顺带把
              「换了一章」这件事说清楚。翻页不换 ci，所以不会误播。 */}
          <div
            key={ci}
            className={'reader-track' + (heavy ? ' is-heavy' : '')}
            ref={trackRef}
            style={{ transform: `translateX(-${page * step}px)` }}
          >
            {blocks.map((b, i) => {
              // 首块可能要裁掉属于上一章的那几行
              const cut = i === 0 ? cutLeadingLines(b, chapter.line) : { node: b, skipped: 0 }
              return cut.node ? (
                <Block
                  key={i}
                  node={cut.node}
                  at={(offsets[i] ?? 0) + cut.skipped}
                  marks={marks}
                  onPick={pickMark}
                />
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

      {/* 批注抽屉 —— 和编辑器里点「＋ 批注」出来的是同一个组件 */}
      <CommentsPanel
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        comments={comments}
        draft={draft}
        onDraftDone={() => setDraft(null)}
        onSave={onSaveComment}
        onDelete={onRemoveComment}
        onJump={(c) => jumpTo(c.id)}
        focusId={focusId}
      />
    </div>
  )
}
