import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { buildExtensions } from './extensions'
import { formatWhen } from '../core/time'
import type { Doc } from '../core/types'
import SlashMenu, { filterSlash, type SlashItem } from '../ui/SlashMenu'
import FindBar from '../ui/FindBar'
import WikiMenu from '../ui/WikiMenu'

interface Props {
  doc: Doc
  saving: 'idle' | 'saving' | 'saved'
  focusMode: boolean
  typewriter: boolean
  tags: string[]
  jumpPath: number[] | null
  onTitle: (title: string) => void
  onChange: (content: JSONContent) => void
  onTags: (tags: string[]) => void
  onJumpDone: () => void
  /** 所有文档标题（`[[` 补全用） */
  allDocs: string[]
  onOpenDoc: (title: string) => void
}

interface Stats {
  chars: number
  blocks: number
}

interface SlashState {
  x: number
  y: number
  query: string
  index: number
}

/** 按「从 doc 根开始的 child index 链」算出 ProseMirror 位置 */
function posOfPath(doc: PMNode, path: number[]): number {
  let pos = 0
  let node: PMNode = doc
  for (const idx of path) {
    if (idx < 0 || idx >= node.childCount) return -1
    let offset = 0
    for (let k = 0; k < idx; k += 1) offset += node.child(k).nodeSize
    pos += offset
    node = node.child(idx)
    pos += 1
  }
  // 落在 listItem 这类容器上时继续往里走，直到进入能放光标的文本块
  let guard = 0
  while (!node.isTextblock && node.childCount > 0 && guard < 10) {
    node = node.child(0)
    pos += 1
    guard += 1
  }
  return node.isTextblock ? pos : -1
}

function countStats(json: JSONContent): Stats {
  let chars = 0
  let blocks = 0
  const walk = (node: JSONContent, top: boolean) => {
    if (node.type === 'text') chars += (node.text ?? '').replace(/\s/g, '').length
    if (top && (node.type === 'paragraph' || node.type === 'heading')) blocks += 1
    node.content?.forEach((c) => walk(c, false))
  }
  json.content?.forEach((c) => walk(c, true))
  return { chars, blocks }
}

export default function EditorPane({
  doc,
  saving,
  focusMode,
  typewriter,
  tags,
  jumpPath,
  onTitle,
  onChange,
  onTags,
  onJumpDone,
  allDocs,
  onOpenDoc,
}: Props) {
  const [stats, setStats] = useState<Stats>(() => countStats(doc.content))
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [wiki, setWiki] = useState<{ x: number; y: number; query: string; index: number } | null>(
    null,
  )
  const wikiRef = useRef<{ x: number; y: number; query: string; index: number } | null>(null)

  useEffect(() => {
    wikiRef.current = wiki
  }, [wiki])
  const scrollRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const slashRef = useRef<SlashState | null>(null)

  useEffect(() => {
    slashRef.current = slash
  }, [slash])

  const editor = useEditor({
    extensions: buildExtensions('写点什么吧……试试输入 - 或 1. 直接变成大纲，输入 / 插入块'),
    content: doc.content,
    autofocus: false,
    editorProps: {
      attributes: { spellcheck: 'false' },
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON()
      setStats(countStats(json))
      onChange(json)

      // `[[` 唤起文档补全
      const { $from } = editor.state.selection
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc')
      const openAt = before.lastIndexOf('[[')
      const closeAt = before.lastIndexOf(']]')
      if (openAt >= 0 && openAt > closeAt) {
        const q = before.slice(openAt + 2)
        const host = hostRef.current
        if (host) {
          try {
            const coords = editor.view.coordsAtPos(editor.state.selection.from)
            const rect = host.getBoundingClientRect()
            const pos = { x: coords.left - rect.left, y: coords.bottom - rect.top + 8 }
            setWiki((w) => (w ? { ...w, query: q } : { ...pos, query: q, index: 0 }))
          } catch {
            /* 坐标算不出来就不弹 */
          }
        }
      } else if (wikiRef.current) {
        setWiki(null)
      }

      // 斜杠菜单跟随输入实时过滤
      if (slashRef.current) {
        const { $from } = editor.state.selection
        const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc')
        const idx = before.lastIndexOf('/')
        if (idx >= 0) setSlash((s) => (s ? { ...s, query: before.slice(idx + 1) } : s))
        else setSlash(null)
      }
    },
  })

  // 挂载即聚焦（切文档时组件按 key 重建，所以每次都会重新聚焦）
  useEffect(() => {
    if (!editor) return
    editor.commands.focus('start')
  }, [editor])

  // 专注模式：靠根节点上的 class 切换，装饰器会据此淡化非当前块
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    if (dom.classList.contains('focus-mode') === focusMode) return
    dom.classList.toggle('focus-mode', focusMode)
    editor.view.dispatch(editor.state.tr)
  }, [editor, focusMode])

  // 打字机模式：光标始终停在视口偏上的固定位置
  useEffect(() => {
    if (!editor || !typewriter) return
    const center = () => {
      const scroller = scrollRef.current
      if (!scroller) return
      let top = 0
      try {
        top = editor.view.coordsAtPos(editor.state.selection.from).top
      } catch {
        return
      }
      const rect = scroller.getBoundingClientRect()
      const delta = top - rect.top - rect.height * 0.4
      if (Math.abs(delta) > 6) scroller.scrollBy({ top: delta, behavior: 'smooth' })
    }
    editor.on('selectionUpdate', center)
    return () => {
      editor.off('selectionUpdate', center)
    }
  }, [editor, typewriter])

  // 从导图点节点跳回正文：定位光标并滚进视野
  useEffect(() => {
    if (!editor || !jumpPath?.length) return
    const pos = posOfPath(editor.state.doc, jumpPath)
    if (pos >= 0) {
      editor.chain().focus().setTextSelection(pos).run()
      try {
        const coords = editor.view.coordsAtPos(pos)
        const scroller = scrollRef.current
        if (scroller) {
          const rect = scroller.getBoundingClientRect()
          scroller.scrollBy({
            top: coords.top - rect.top - rect.height * 0.35,
            behavior: 'smooth',
          })
        }
      } catch {
        /* 算不出坐标就算了 */
      }
    }
    onJumpDone()
  }, [editor, jumpPath, onJumpDone])

  // 切换文档：换内容但不触发保存（否则会把新内容写进旧文档）
  const idRef = useRef(doc.id)
  useEffect(() => {
    if (!editor) return
    if (idRef.current === doc.id) return
    idRef.current = doc.id
    editor.commands.setContent(doc.content, { emitUpdate: false })
    setStats(countStats(doc.content))
    editor.commands.focus('start')
  }, [editor, doc.id, doc.content])

  const items = useMemo(() => (slash ? filterSlash(slash.query) : []), [slash])

  const runSlash = useCallback(
    (item: SlashItem) => {
      if (!editor) return
      const { from, $from } = editor.state.selection
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc')
      const idx = before.lastIndexOf('/')
      const start = idx >= 0 ? from - (before.length - idx) : from
      editor.chain().focus().deleteRange({ from: start, to: from }).run()
      item.run(editor)
      setSlash(null)
    },
    [editor],
  )

  const wikiItems = useMemo(() => {
    if (!wiki) return []
    const q = wiki.query.trim().toLowerCase()
    const list = q ? allDocs.filter((t) => t.toLowerCase().includes(q)) : allDocs
    return list.slice(0, 8)
  }, [wiki, allDocs])

  const runWiki = useCallback(
    (title: string) => {
      if (!editor) return
      const { from, $from } = editor.state.selection
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc')
      const openAt = before.lastIndexOf('[[')
      const start = openAt >= 0 ? from - (before.length - openAt) : from
      editor
        .chain()
        .focus()
        .deleteRange({ from: start, to: from })
        .insertContent(`[[${title}]] `)
        .run()
      setWiki(null)
    },
    [editor],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!editor) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFindOpen(true)
        return
      }

      if (wiki) {
        const list = wikiItems
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setWiki({ ...wiki, index: (wiki.index + 1) % Math.max(list.length, 1) })
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setWiki({
            ...wiki,
            index: (wiki.index - 1 + Math.max(list.length, 1)) % Math.max(list.length, 1),
          })
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          const picked = list[wiki.index] ?? list[0]
          if (picked) runWiki(picked)
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setWiki(null)
          return
        }
      }

      if (slash) {
        const list = filterSlash(slash.query)
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSlash({ ...slash, index: (slash.index + 1) % Math.max(list.length, 1) })
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSlash({
            ...slash,
            index: (slash.index - 1 + Math.max(list.length, 1)) % Math.max(list.length, 1),
          })
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          const picked = list[slash.index] ?? list[0]
          if (picked) runSlash(picked)
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setSlash(null)
          return
        }
      }

      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // 只在行首或空白之后触发，免得打 URL 时乱弹
        const { $from } = editor.state.selection
        const prev =
          $from.parentOffset > 0
            ? $from.parent.textBetween($from.parentOffset - 1, $from.parentOffset, undefined, '\ufffc')
            : ''
        if (prev && !/\s/.test(prev)) return

        window.setTimeout(() => {
          const view = editor.view
          const host = hostRef.current
          if (!host) return
          try {
            const coords = view.coordsAtPos(view.state.selection.from)
            const rect = host.getBoundingClientRect()
            setSlash({
              x: coords.left - rect.left,
              y: coords.bottom - rect.top + 8,
              query: '',
              index: 0,
            })
          } catch {
            /* 位置算不出来就算了 */
          }
        }, 0)
      }
    },
    [editor, slash, runSlash, wiki, wikiItems, runWiki],
  )

  const minutes = Math.max(1, Math.round(stats.chars / 350))

  return (
    <div
      className={'editor-scroll' + (typewriter ? ' typewriter' : '')}
      ref={scrollRef}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) editor?.commands.focus('end')
      }}
      onClick={(e) => {
        const el = (e.target as HTMLElement).closest?.('.wikilink')
        const target = el?.getAttribute('data-target')
        if (target) onOpenDoc(target)
      }}
    >
      <div className="editor-inner" ref={hostRef}>
        <input
          className="doc-title"
          value={doc.title}
          placeholder="无标题"
          spellCheck={false}
          onChange={(e) => onTitle(e.target.value)}
        />
        <div className="doc-meta">
          <span>{formatWhen(doc.updatedAt)}</span>
          <span className="dot" />
          <span>{stats.chars} 字</span>
          <span className="dot" />
          <span>{stats.blocks} 段</span>
          <span className="dot" />
          <span>约 {minutes} 分钟</span>
          <span
            className={
              'save-flag' + (saving === 'saving' ? ' saving' : saving === 'saved' ? ' saved' : '')
            }
          >
            {saving === 'saving' ? '保存中…' : saving === 'saved' ? '已保存' : ''}
          </span>
        </div>
        <div className="tag-editor" style={{ marginBottom: 18 }}>
          {tags.map((t) => (
            <span className="tag" key={t}>
              {t}
              <button title="移除标签" onClick={() => onTags(tags.filter((x) => x !== t))}>
                ×
              </button>
            </span>
          ))}
          <input
            className="tag-input"
            placeholder="＋ 标签"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              const el = e.target as HTMLInputElement
              const value = el.value.trim()
              if (value && !tags.includes(value)) onTags([...tags, value])
              el.value = ''
            }}
          />
        </div>
        <EditorContent editor={editor} />
        {slash && (
          <SlashMenu
            items={items}
            index={slash.index}
            x={slash.x}
            y={slash.y}
            onPick={runSlash}
          />
        )}
        {wiki && (
          <WikiMenu
            items={wikiItems}
            index={wiki.index}
            x={wiki.x}
            y={wiki.y}
            onPick={runWiki}
          />
        )}
      </div>
      <FindBar open={findOpen} editor={editor} onClose={() => setFindOpen(false)} />
    </div>
  )
}
