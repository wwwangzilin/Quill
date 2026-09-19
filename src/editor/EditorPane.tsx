import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { JSONContent, Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { buildExtensions } from './extensions'
import { formatWhen } from '../core/time'
import { storage } from '../core/storage'
import { toast } from '../ui/toast'
import type { Doc } from '../core/types'
import SlashMenu, { filterSlash, type SlashItem } from '../ui/SlashMenu'
import FindBar from '../ui/FindBar'
import WikiMenu from '../ui/WikiMenu'
import { useAiComplete } from './useAiComplete'
import { acceptAi, aiState, clearAi } from './aiComplete'
import AiSelectionBar from '../ui/AiSelectionBar'
import { importAssetFile } from '../core/desktop'

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
  /** AI 续写开关（默认关，费钱的东西不能默认开） */
  aiEnabled: boolean
  /** 停手多少毫秒之后才请求 */
  aiDelay: number
  /** 把编辑器实例交给上层（复制富文本、问文档之类要用） */
  onReady?: (editor: Editor) => void
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

/* ------------------------- 媒体：粘贴 / 拖拽 ------------------------- */

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv|mkv)$/i
/** 只认图片直链 —— 别把随便一个网址当成图片插进去 */
const IMAGE_URL = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif|svg)(\?\S*)?$/i

function mediaKind(name: string, mime = ''): 'image' | 'video' | null {
  if (mime.startsWith('image/') || IMAGE_EXT.test(name)) return 'image'
  if (mime.startsWith('video/') || VIDEO_EXT.test(name)) return 'video'
  return null
}

/** 路径 → 文件名（拖进来的文件用它当 alt/title） */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
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
  aiEnabled,
  aiDelay,
  onReady,
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
  /** onUpdate 是在 useEditor 里一次性闭包捕获的，用 ref 拿到最新的触发器 */
  const aiScheduleRef = useRef<() => void>(() => {})

  useEffect(() => {
    slashRef.current = slash
  }, [slash])

  const editor = useEditor({
    extensions: buildExtensions('写点什么吧……试试输入 - 或 1. 直接变成大纲，输入 / 插入块'),
    content: doc.content,
    autofocus: false,
    editorProps: {
      attributes: { spellcheck: 'false' },
      // 截图直接 Ctrl+V 贴进来。落盘是异步的，editorProps 只求值一次，
      // 所以真正的实现挂在 ref 上（同 useAiComplete 那套处理）
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.items ?? [])
          .filter((it) => it.kind === 'file')
          .map((it) => it.getAsFile())
          .filter((f): f is File => Boolean(f))
        if (files.length) {
          event.preventDefault()
          pasteFilesRef.current(files)
          return true
        }
        return false
      },
      // 从资源管理器拖文件进来。桌面版主要走 Tauri 的原生拖拽事件（能拿到真实路径），
      // 这条是浏览器模式与原生事件失灵时的兜底
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? [])
        if (files.length) {
          event.preventDefault()
          pasteFilesRef.current(files)
          return true
        }
        return false
      },
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

      // AI 续写：停手一会儿再问模型（打字过程中反复调用只会保留最后一次）
      aiScheduleRef.current()
    },
  })

  const ai = useAiComplete({ editor, enabled: aiEnabled, delay: aiDelay, title: doc.title })
  const aiCancelRef = useRef<() => void>(() => {})
  useEffect(() => {
    aiScheduleRef.current = ai.schedule
    aiCancelRef.current = ai.cancel
  }, [ai.schedule, ai.cancel])

  /**
   * Tab / Esc 用「捕获阶段」的 DOM 监听来处理。
   *
   * 为什么不放在 ProseMirror 插件的 handleKeyDown 里：实测它排在 Tiptap 那一长串
   * keymap handler 的中后段（第 54 个），按 Tab 会被「缩进」先认领走；
   * 就算把扩展 priority 拉到 1000 也没抢过它。捕获阶段一定先执行，稳。
   */
  useEffect(() => {
    const dom = editor?.view.dom
    if (!dom) return
    const onKey = (e: KeyboardEvent) => {
      const s = aiState(editor.view)
      if (import.meta.env.DEV) {
        const w = window as unknown as Record<string, unknown>
        const log = (w.__aiTabLog as string[]) ?? []
        log.push(`${e.key} state=${s ? JSON.stringify(s) : 'null'}`)
        w.__aiTabLog = log
      }
      if (!s || (!s.text && !s.loading && !s.error)) return
      // 关键：先 cancel（让还在飞的流式回调失效），否则清掉之后又被模型推回来
      if (e.key === 'Tab' && s.text) {
        e.preventDefault()
        e.stopPropagation()
        aiCancelRef.current()
        acceptAi(editor.view)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        aiCancelRef.current()
        clearAi(editor.view)
      }
    }
    dom.addEventListener('keydown', onKey, true)
    return () => dom.removeEventListener('keydown', onKey, true)
  }, [editor])

  // 挂载即聚焦（切文档时组件按 key 重建，所以每次都会重新聚焦）
  useEffect(() => {
    if (!editor) return
    editor.commands.focus('start')
  }, [editor])

  // 调试/验收用：dev 下把编辑器实例挂到 window，
  // 这样 CDP 脚本能直接读写文档、模拟按键（生产构建里这段会被摇掉）
  useEffect(() => {
    if (!editor || !import.meta.env.DEV) return
    ;(window as unknown as Record<string, unknown>).__quillEditor = editor
  }, [editor])

  // 上层要拿编辑器实例（复制富文本等）
  useEffect(() => {
    if (editor && onReady) onReady(editor)
  }, [editor, onReady])

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

    /**
     * 拖拽选择期间绝对不能滚动视口：滚动会让鼠标底下的文档位置一直在变，
     * 选区越拉越大 → 又触发滚动，正反馈把整篇都选上。
     *
     * 但注意别把「单击定位光标」也误判成拖拽 —— 单击时 selectionUpdate 正好
     * 发生在 mousedown 与 mouseup 之间，一刀切会让自动跟踪整个失效。
     * 所以判据是「按住了**并且移动过**」，外加超时兜底（mouseup 有可能丢）。
     */
    let isDown = false
    let moved = false
    let downAt = 0
    let downX = 0
    let downY = 0

    const onDown = (e: MouseEvent) => {
      isDown = true
      moved = false
      downAt = Date.now()
      downX = e.clientX
      downY = e.clientY
    }
    const onMove = (e: MouseEvent) => {
      if (!isDown || moved) return
      if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) moved = true
    }
    const onUp = () => {
      isDown = false
      moved = false
    }

    const center = () => {
      // 真在拖拽就不动视口
      if (isDown && moved) return
      // 兜底：按住超过 1.2 秒还"没松手"，说明 mouseup 丢了，当作已松开
      if (isDown && Date.now() - downAt > 1200) {
        isDown = false
        moved = false
      }
      const el = scrollRef.current
      if (!el) return
      let top = 0
      try {
        top = editor.view.coordsAtPos(editor.state.selection.from).top
      } catch {
        return
      }
      const rect = el.getBoundingClientRect()
      const delta = top - rect.top - rect.height * 0.4
      if (Math.abs(delta) > 6) el.scrollBy({ top: delta, behavior: 'smooth' })
    }

    editor.on('selectionUpdate', center)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('mouseup', onUp, true)
    window.addEventListener('blur', onUp)
    return () => {
      editor.off('selectionUpdate', center)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('mouseup', onUp, true)
      window.removeEventListener('blur', onUp)
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

  /** 拖着文件悬在窗口上时的高亮 */
  const [dropping, setDropping] = useState(false)
  /** editorProps 里的 handler 只求值一次，异步落盘的实际实现得挂在 ref 上 */
  const pasteFilesRef = useRef<(files: File[]) => void>(() => {})
  const dropPathsRef = useRef<(paths: string[], x?: number, y?: number) => void>(() => {})

  /** 文件 → 仓库 assets/ → 插入节点。给了 pos 就插那儿，否则插在光标处 */
  const insertFiles = useCallback(
    async (files: File[], pos?: number) => {
      if (!editor) return
      let at = pos
      for (const file of files) {
        const kind = mediaKind(file.name, file.type)
        if (!kind) continue
        try {
          const b64 = await toBase64(file)
          const src = storage.saveAsset
            ? await storage.saveAsset(file.name, b64)
            : `data:${file.type || 'application/octet-stream'};base64,${b64}`
          const attrs =
            kind === 'image' ? { src, alt: file.name, title: null } : { src, title: file.name }
          const node = { type: kind, attrs }
          if (typeof at === 'number') {
            editor.chain().focus().insertContentAt(at, node).run()
            // 后面几个插在光标处就行，免得位置越算越偏
            at = undefined
          } else {
            editor.chain().focus().insertContent(node).run()
          }
          toast.success(kind === 'image' ? '已插入图片' : '已插入视频', file.name)
        } catch (err) {
          toast.error('插入失败', String(err).slice(0, 120))
        }
      }
    },
    [editor],
  )

  /** 拖进来的本地文件：只把路径交给 Rust 去复制，不走 base64 */
  const insertPaths = useCallback(
    async (paths: string[], x?: number, y?: number) => {
      if (!editor) return
      let at: number | undefined
      if (typeof x === 'number' && typeof y === 'number') {
        try {
          at = editor.view.posAtCoords({ left: x, top: y })?.pos
        } catch {
          at = undefined
        }
      }
      for (const p of paths) {
        const name = baseName(p)
        const kind = mediaKind(name)
        if (!kind) continue
        try {
          const src = await importAssetFile(p)
          const attrs = kind === 'image' ? { src, alt: name, title: null } : { src, title: name }
          const node = { type: kind, attrs }
          if (typeof at === 'number') {
            editor.chain().focus().insertContentAt(at, node).run()
            at = undefined
          } else {
            editor.chain().focus().insertContent(node).run()
          }
          toast.success(kind === 'image' ? '已插入图片' : '已插入视频', name)
        } catch (err) {
          toast.error('插入失败', String(err).slice(0, 120))
        }
      }
    },
    [editor],
  )

  useEffect(() => {
    pasteFilesRef.current = (files) => void insertFiles(files)
  }, [insertFiles])
  useEffect(() => {
    dropPathsRef.current = (paths, x, y) => void insertPaths(paths, x, y)
  }, [insertPaths])

  /**
   * 桌面版：从资源管理器拖进来的文件走 Tauri 的原生拖拽事件。
   * 它能给真实路径，所以大视频不用先编 base64 —— 直接让 Rust 复制进 assets/。
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return
    let unlisten: (() => void) | undefined
    let alive = true
    void (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview')
        const un = await getCurrentWebview().onDragDropEvent((event) => {
          const p = event.payload
          if (p.type === 'enter' || p.type === 'over') {
            setDropping(true)
          } else if (p.type === 'leave') {
            setDropping(false)
          } else if (p.type === 'drop') {
            setDropping(false)
            // Tauri 给的是物理像素，换成 CSS 像素才对得上 posAtCoords
            const ratio = window.devicePixelRatio || 1
            dropPathsRef.current(p.paths, p.position.x / ratio, p.position.y / ratio)
          }
        })
        if (alive) unlisten = un
        else un()
      } catch {
        /* 浏览器模式没有这个 API */
      }
    })()
    return () => {
      alive = false
      unlisten?.()
    }
  }, [])

  /** 选本地文件 → 存进仓库 assets/ → 插入节点 */
  const pickMedia = useCallback(
    (kind: 'image' | 'video') => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = kind === 'image' ? 'image/*' : 'video/*'
      input.onchange = () => {
        const file = input.files?.[0]
        if (file) void insertFiles([file])
      }
      input.click()
    },
    [insertFiles],
  )

  const runSlash = useCallback(
    (item: SlashItem) => {
      if (!editor) return
      const { from, $from } = editor.state.selection
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc')
      const idx = before.lastIndexOf('/')
      const start = idx >= 0 ? from - (before.length - idx) : from
      editor.chain().focus().deleteRange({ from: start, to: from }).run()
      setSlash(null)
      if (item.media) {
        pickMedia(item.media)
        return
      }
      item.run(editor)
    },
    [editor, pickMedia],
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
        <AiSelectionBar editor={editor} host={hostRef} />
      </div>
      {dropping && (
        <div className="drop-veil">
          <div className="drop-card">松手就插进来 · 图片 / 视频</div>
        </div>
      )}
      <FindBar open={findOpen} editor={editor} onClose={() => setFindOpen(false)} />
    </div>
  )
}
