import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { buildExtensions } from '../editor/extensions'
import { parseDocument } from '../core/md-parse'
import { docToMarkdown } from '../core/markdown'
import { fnv1a32 } from '../core/chapterOrigin'
import { storage } from '../core/storage'
import { toast } from '../ui/toast'
import type { RawChapter } from '../core/rawChapters'

/**
 * 长文本编辑器：按章节窗口化加载，**仍然能改字**。
 *
 * 和旧的「分栏阅读」的区别只有一句话：那个只能看，这个能写。为了做到这一点，
 * 它一次只挂三章（当前 + 前后各一），其余章节只留标题与占位高度 ——
 * 700 万字的稿子要是整篇进 ProseMirror，光建块就二十多万个，必死。
 *
 * 三章各是**独立的 ProseMirror 实例**，不是一篇文档切三段：
 * 卸载一章时不必对文档模型发一个巨大的 transaction，撤销栈也不会断在中间。
 *
 * 存盘走 Rust 的「按章写回」（write_doc_slice）：带着这一章当前的字节区间和摘要，
 * 对不上就拒绝。每写完一章，后面所有章的偏移按长度差整体平移 —— 索引只在前端维护，
 * 不重新扫描整个文件。
 */

/** 一章的运行时状态 */
interface Chap {
  index: number
  title: string
  /** 当前文件里的绝对字节偏移（写完一章会整体平移） */
  from: number
  to: number
  /** 当前内容的 FNV-1a（按 UTF-8 字节），写回时用来确认没被别人动过 */
  digest: number
  /** 打开时的原文，用来判断「这一章有没有真的改过」 */
  baseline: string
  /** 最新的 Markdown（没加载过的章是 undefined） */
  md?: string
  /** 是否已经读进内存 */
  loaded: boolean
}

/** 估算一章没加载时的高度：中文正文约 3 字节一个字，一行约 40 字 */
function estimateHeight(bytes: number): number {
  const chars = Math.max(bytes / 3, 0)
  const lines = chars / 40
  return Math.min(Math.max(lines * 30 + 40, 120), 20000)
}

/** 按 UTF-8 算字节数 —— 写回时偏移要按字节，不能按字符 */
const bytesOf = (s: string) => new TextEncoder().encode(s).length

interface Props {
  file: string
  title: string
  /** 退出长文本模式（回到普通界面）—— 只有规模允许时上层才给 */
  onExit?: () => void
  /** 有未保存内容时通知上层（状态栏用） */
  onSavingChange?: (state: 'idle' | 'saving' | 'saved') => void
}

export default function LongformEditor({ file, title, onExit, onSavingChange }: Props) {
  const [chaps, setChaps] = useState<Chap[]>([])
  const [current, setCurrent] = useState(0)
  /** 已经挂上编辑器的章号 —— 窗口 = current - 1 .. current + 1 */
  const [mounted, setMounted] = useState<number[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [ready, setReady] = useState(false)

  const chapsRef = useRef<Chap[]>([])
  const currentRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef(new Map<number, HTMLElement>())
  const saveTimer = useRef<number | null>(null)
  /** 存盘串行化：一次只写一章，写完再算下一章的偏移 */
  const savingRef = useRef(false)

  chapsRef.current = chaps
  currentRef.current = current

  /* ---------------- 打开：先拿索引，再按窗口读正文 ---------------- */

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!storage.outline || !storage.readSlice) {
        toast.error('这个版本不支持长文本模式')
        return
      }
      const o = await storage.outline(file)
      if (!alive) return
      const list: Chap[] = o.marks.map((m: RawChapter, i: number) => ({
        index: i,
        // 没有标题的文本按字节切块，索引里标题是空的 —— 给个能认的位置名
        title: m.title || `片段 ${i + 1}`,
        from: m.from,
        to: m.to,
        digest: 0,
        baseline: '',
        loaded: false,
      }))
      setChaps(list)
      chapsRef.current = list
      await loadWindow(0, list)
      if (!alive) return
      setReady(true)
      // 首次进入的提示只弹一次
      const key = 'quill-longform-toast'
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, '1')
        toast.ask('已进入长文本模式', '按章节加载与编辑：一次只挂当前章和前后各一章', [
          { label: '查看章节', primary: true, run: () => setSidebarOpen(true) },
          { label: '知道了', run: () => {} },
        ])
      }
    })()
    return () => {
      alive = false
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  /** 读一批章节的正文（当前章 + 前后各一） */
  const loadWindow = useCallback(
    async (center: number, base?: Chap[]) => {
      const list = base ?? chapsRef.current
      const want = [center - 1, center, center + 1].filter((i) => i >= 0 && i < list.length)
      const need = want.filter((i) => !list[i].loaded && !list[i].md)
      if (!need.length) {
        setMounted(want)
        return
      }
      const next = [...list]
      await Promise.all(
        need.map(async (i) => {
          const raw = await storage.readSlice!(file, list[i].from, list[i].to)
          next[i] = {
            ...next[i],
            md: raw,
            baseline: raw,
            digest: fnv1a32(raw),
            loaded: true,
          }
        }),
      )
      chapsRef.current = next
      setChaps(next)
      setMounted(want)
    },
    [file],
  )

  /**
   * 滚到哪一章：按**视口中心**判定，不是光标。
   *
   * 光标可能在只读的邻章里（点了一下），按光标算会把那一章突然变成可编辑、
   * 当前章变只读 —— 手一抖整个文档的可编辑区就换了位置。
   */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !ready) return
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        const center = el.scrollTop + el.clientHeight / 2
        let hit = currentRef.current
        for (const [i, node] of sectionRefs.current) {
          if (!node) continue
          const top = node.offsetTop
          if (center >= top && center < top + node.offsetHeight) {
            hit = i
            break
          }
        }
        if (hit !== currentRef.current) {
          currentRef.current = hit
          setCurrent(hit)
          void loadWindow(hit)
        }
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [ready, loadWindow])

  /* ---------------- 编辑与存盘 ---------------- */

  const onChapterMd = useCallback((i: number, md: string) => {
    const list = chapsRef.current
    if (!list[i] || list[i].md === md) return
    const next = [...list]
    next[i] = { ...next[i], md }
    chapsRef.current = next
    setChaps(next)
    scheduleSave()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * 把改过的章按顺序写回去。
   *
   * 每写完一章，后面所有章的字节偏移都要按长度差平移 —— 不重新扫整个文件，
   * 因为那正是长文本模式不能做的事。摘要用「写之前的这一章」的，写完再更新。
   */
  const flushDirty = useCallback(async () => {
    if (savingRef.current) return
    const list = chapsRef.current
    const dirty = list.filter((c) => c.md !== undefined && c.md !== c.baseline)
    if (!dirty.length) return
    savingRef.current = true
    onSavingChange?.('saving')
    try {
      for (const dirtyChap of dirty) {
        // 每轮都从最新状态里重新取：上一章写完会平移这一章的偏移
        const i = dirtyChap.index
        const cur = chapsRef.current[i]
        if (!cur?.md || cur.md === cur.baseline) continue
        const text = cur.md.endsWith('\n') ? cur.md : `${cur.md}\n`
        const size = await storage.writeSlice!(file, cur.from, cur.to, text, cur.digest)
        const grown = bytesOf(text) - (cur.to - cur.from)
        const next = chapsRef.current.map((c) => {
          if (c.index === i) {
            return {
              ...c,
              to: c.from + bytesOf(text),
              digest: fnv1a32(text),
              baseline: text,
              md: text,
            }
          }
          if (c.index > i) return { ...c, from: c.from + grown, to: c.to + grown }
          return c
        })
        chapsRef.current = next
        setChaps(next)
        // writeSlice 返回的是整个文件的新字节数，留个念想但不参与计算
        void size
      }
      onSavingChange?.('saved')
    } catch (err) {
      toast.error('长文本保存失败', String(err).slice(0, 160))
      onSavingChange?.('idle')
    } finally {
      savingRef.current = false
    }
  }, [file, onSavingChange])

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      void flushDirty()
    }, 1500)
  }, [flushDirty])

  /** 关窗口/切走之前兜一次，别把最后 1.5 秒丢了 */
  useEffect(() => {
    const onLeave = () => void flushDirty()
    window.addEventListener('beforeunload', onLeave)
    return () => {
      window.removeEventListener('beforeunload', onLeave)
      void flushDirty()
    }
  }, [flushDirty])

  /* ---------------- 章节导航 ---------------- */

  const jumpTo = useCallback(
    async (i: number) => {
      setSidebarOpen(false)
      const list = chapsRef.current
      if (!list[i]) return
      if (!list[i].loaded) {
        // 目标章在窗口外：先把当前改过的写回去，再重设窗口
        await flushDirty()
        await loadWindow(i)
      }
      setCurrent(i)
      const node = sectionRefs.current.get(i)
      if (node) node.scrollIntoView({ block: 'start', behavior: 'smooth' })
    },
    [flushDirty, loadWindow],
  )

  const dirtyCount = useMemo(
    () => chaps.filter((c) => c.md !== undefined && c.md !== c.baseline).length,
    [chaps],
  )

  return (
    <div className="lf">
      <div className="lf-bar">
        <button className="btn ghost icon" onClick={() => setSidebarOpen((v) => !v)} title="章节目录">
          ☰
        </button>
        <span className="lf-title">{title}</span>
        <span className="lf-meta">
          {chaps.length ? `${current + 1} / ${chaps.length} 章` : '载入中…'}
          {dirtyCount > 0 && <em className="lf-dirty">{dirtyCount} 章未保存</em>}
        </span>
        <span className="grow" />
        {onExit && (
          <button className="btn ghost" onClick={onExit} title="回到普通界面">
            退出长文本
          </button>
        )}
      </div>

      <div className="lf-scroll" ref={scrollRef}>
        {!ready && <div className="lf-loading">正在建立章节索引…</div>}
        {chaps.map((c) => {
          const isMounted = mounted.includes(c.index)
          const editable = c.index === current
          return (
            <section
              key={c.index}
              ref={(node) => {
                if (node) sectionRefs.current.set(c.index, node)
                else sectionRefs.current.delete(c.index)
              }}
              className={'lf-chapter' + (c.index === current ? ' is-current' : '')}
              data-chars={Math.round((c.to - c.from) / 3)}
            >
              <header className="lf-chapter-head">
                <span className="lf-chapter-no">{String(c.index + 1).padStart(2, '0')}</span>
                <span className="lf-chapter-title">{c.title}</span>
                <span className="lf-chapter-badge">
                  {editable ? '编辑中' : isMounted ? '已预载' : '未加载'}
                </span>
              </header>
              {isMounted && c.md !== undefined ? (
                <ChapterPane
                  index={c.index}
                  md={c.md}
                  editable={editable}
                  onChange={(md) => onChapterMd(c.index, md)}
                />
              ) : (
                <div
                  className="lf-placeholder"
                  style={{ height: estimateHeight(c.to - c.from) }}
                  onClick={() => void jumpTo(c.index)}
                >
                  <span>点一下载入这一章</span>
                </div>
              )}
            </section>
          )
        })}
      </div>

      {sidebarOpen && (
        <>
          <div className="lf-backdrop" onClick={() => setSidebarOpen(false)} />
          <aside className="lf-sidebar">
            <header>
              章节 <span>{chaps.length}</span>
              <button className="btn ghost icon" onClick={() => setSidebarOpen(false)}>
                ✕
              </button>
            </header>
            <ol>
              {chaps.map((c) => {
                const dirty = c.md !== undefined && c.md !== c.baseline
                return (
                  <li
                    key={c.index}
                    className={c.index === current ? 'on' : ''}
                    onClick={() => void jumpTo(c.index)}
                  >
                    <span className="lf-side-no">{String(c.index + 1).padStart(2, '0')}</span>
                    <span className="lf-side-title">{c.title}</span>
                    {dirty && <span className="lf-side-dirty" title="有未保存的改动" />}
                    <span className="lf-side-chars">{Math.round((c.to - c.from) / 3)}</span>
                  </li>
                )
              })}
            </ol>
          </aside>
        </>
      )}
    </div>
  )
}

/**
 * 一章的编辑器实例。卸载即销毁 —— 这正是窗口化想要的行为。
 */
function ChapterPane({
  index,
  md,
  editable,
  onChange,
}: {
  index: number
  md: string
  editable: boolean
  onChange: (md: string) => void
}) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const editor = useEditor(
    {
      extensions: buildExtensions(''),
      content: parseDocument(md).doc,
      editable,
      onUpdate: ({ editor }) => {
        onChangeRef.current(docToMarkdown(editor.getJSON()))
      },
    },
    [index],
  )

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(editable)
  }, [editor, editable])

  return (
    <div className={'lf-body' + (editable ? '' : ' is-readonly')}>
      <EditorContent editor={editor} />
    </div>
  )
}
