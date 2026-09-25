import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSONContent, Editor } from '@tiptap/core'
import EditorPane from './editor/EditorPane'
import Sidebar from './ui/Sidebar'
import MindMap from './ui/MindMap'
import HistoryDrawer from './ui/HistoryDrawer'
import ToastHost from './ui/ToastHost'
import { toast } from './ui/toast'
import { useSetting } from './core/settings'
import ShortcutsPanel from './ui/ShortcutsPanel'
import TrashPanel from './ui/TrashPanel'
import SettingsView from './ui/SettingsView'
import DocLibrary from './ui/DocLibrary'
import MoreMenu, { type MenuItem } from './ui/MoreMenu'
import WindowControls from './ui/WindowControls'
import CommandPalette, { type PaletteCommand } from './ui/CommandPalette'
import SearchPanel from './ui/SearchPanel'
import { scanMatches } from './editor/search'
import type { DocSearchHit } from './core/searchDocs'
import BacklinksPanel from './ui/BacklinksPanel'
import AiChatPanel from './ui/AiChatPanel'
import QuickCapture from './ui/QuickCapture'
import CommentsPanel from './ui/CommentsPanel'
import { locate, type Comment } from './core/comments'
import { checkUpdate } from './core/update'
import { applyTheme, nextTheme, readTheme, themeInfo, type Theme } from './core/theme'
import { applyAutoHide, readAutoHide } from './core/chrome'
import { applyComments, onCommentPick } from './editor/commentMark'
import { goalProgress } from './core/stats'
import { TEMPLATES } from './core/templates'
import { openQuickNote, openSticky } from './core/windows'
import {
  DEFAULT_PREFS,
  autostartEnabled,
  importMarkdown,
  isDesktop,
  loadDesktopPrefs,
  readMarkdownFolder,
  saveDesktopPrefs,
  setAutostart,
  type DesktopPrefs,
} from './core/desktop'
import {
  applyProse,
  clampWidth,
  PROSE_RANGE,
  readProse,
  saveProse,
  type ProseStyle,
} from './core/fonts'
import { initStorage, storage } from './core/storage'
import { docToMarkdown, safeFileName } from './core/markdown'
import type { Doc, DocMeta, ViewMode } from './core/types'
import { WELCOME } from './core/welcome'
import { setAssetResolver } from './core/asset'

type Saving = 'idle' | 'saving' | 'saved'

/**
 * 在当前编辑器里跳到第 nth 个匹配处。
 *
 * 只把**光标**落过去，不选中那个词 —— 选中了的话，用户跳过来顺手一打字
 * 就把刚找到的词覆盖掉了。光标停在词首，接着写也安全。
 */
function jumpToNth(ed: Editor, query: string, nth: number) {
  const hits = scanMatches(ed, query)
  if (!hits.length) return
  const i = Math.min(Math.max(nth, 0), hits.length - 1)
  ed.chain().focus().setTextSelection(hits[i].from).scrollIntoView().run()
}

function toMeta(doc: Doc): DocMeta {
  return {
    id: doc.id,
    title: doc.title,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    starred: doc.starred,
  }
}

function download(name: string, text: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** 把正文 HTML 包成一个自带排版样式的独立文件，发出去就能直接看 */
function buildStandaloneHtml(title: string, body: string): string {
  const safe = title.replace(
    /[<>&]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c,
  )
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safe}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0 auto; max-width: 720px; padding: 56px 24px 96px;
         font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
         font-size: 16.5px; line-height: 1.85; color: #23201d; background: #faf8f5; }
  h1 { font-size: 1.9em; margin: 1.6em 0 .6em; }
  h2 { font-size: 1.4em; }
  h3 { font-size: 1.15em; }
  h1, h2, h3 { line-height: 1.35; }
  code { background: #efece7; padding: .15em .4em; border-radius: 4px; font-size: .9em; }
  pre { background: #f2efe9; padding: 14px 16px; border-radius: 10px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 1em 0; padding: .2em 1em; border-left: 3px solid #d8d2c8; color: #6b645c; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e2ddd4; padding: 8px 12px; text-align: left; }
  img, video { max-width: 100%; border-radius: 8px; }
  hr { border: none; border-top: 1px solid #e2ddd4; margin: 2em 0; }
  @media (prefers-color-scheme: dark) {
    body { color: #e8e3dc; background: #16150f; }
    code { background: #26241c; }
    pre { background: #1e1c16; }
    blockquote { border-color: #3a362c; color: #a49c90; }
    th, td { border-color: #322f26; }
    hr { border-color: #322f26; }
  }
</style>
</head>
<body>
${body}
</body>
</html>
`
}

function sortDocs(list: DocMeta[]): DocMeta[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 去空白字符数，用于统计与热力图 */
function countChars(json: JSONContent): number {
  let n = 0
  const walk = (node: JSONContent) => {
    if (node.type === 'text') n += (node.text ?? '').replace(/\s/g, '').length
    node.content?.forEach(walk)
  }
  walk(json)
  return n
}

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

export default function App() {
  const [docs, setDocs] = useState<DocMeta[]>([])
  const [doc, setDoc] = useState<Doc | null>(null)
  const [view, setView] = useState<ViewMode>('write')
  // 默认收起：平时写作就是全宽的，跟 Word 一样干净；选文档走文档库。
  // ☰ 仍可随时唤出（热力图、每日目标那些还在里面）。
  const [sidebarOpen, setSidebarOpen] = useState(false)
  /** 鼠标贴到左边缘临时唤出的侧栏 —— 看一眼就够，不改 ☰ 的开关状态 */
  const [sidebarPeek, setSidebarPeek] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => readTheme())
  /** 换个主题：标题栏按钮和命令面板共用；按主题清单的顺序往下循环 */
  const cycleTheme = useCallback(() => setTheme((t) => nextTheme(t)), [])

  /** 打字时把底栏与侧栏收起来（鼠标一动就回来） */
  const [autoHide, setAutoHide] = useState(readAutoHide)
  const [barsHidden, setBarsHidden] = useState(false)
  /** 无边框窗口的顶栏：默认藏着，鼠标够到右上角才滑出来 */
  const [barShown, setBarShown] = useState(false)
  const [saving, setSaving] = useState<Saving>('idle')
  const [ready, setReady] = useState(false)
  const [mapSnap, setMapSnap] = useState<{ content: JSONContent; title: string } | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [vaultMode, setVaultMode] = useState(false)
  const [vaultLabel, setVaultLabel] = useState('')
  const [focusMode, setFocusMode] = useSetting('focus-mode', false)
  const [typewriter, setTypewriter] = useSetting('typewriter', false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [allTags, setAllTags] = useState<string[]>([])
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [stats, setStats] = useState<Record<string, number>>({})
  const [jumpPath, setJumpPath] = useState<number[] | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  /** 正文外观：字体 / 字号 / 行距，改了立刻写进 CSS 变量 */
  const [prose, setProse] = useState<ProseStyle>(() => readProse())
  /** AI 续写：默认关。这东西每敲几个字就得花钱，不能默认替主人做决定 */
  const [aiEnabled, setAiEnabled] = useSetting('ai-enabled', false)
  const [aiDelay, setAiDelay] = useSetting('ai-delay', 800)
  /** 「问这篇文档」面板 */
  const [chatOpen, setChatOpen] = useState(false)
  /** 每日写作目标（0 = 不设目标） */
  const [dailyGoal, setDailyGoal] = useSetting('daily-goal', 500)
  // 底部状态栏要用：今日写了多少、离目标还差多少
  const progress = useMemo(() => goalProgress(stats, dailyGoal), [stats, dailyGoal])
  /** 编辑器实例的重建键：只在新开文档时递增，改名导致的 id 变化不重建（否则光标会飞） */
  const [sessionKey, setSessionKey] = useState(0)
  /** 阅读模式：只读、收起干扰，用来回头通读 */
  const [reading, setReading] = useState(false)
  /** 禅模式：窗口真全屏 + 藏掉整个界面，只剩正文（F11） */
  const [zen, setZen] = useState(false)

  /** 只在写作视图、且不在阅读/禅模式下才自动收 —— 那几个模式自己管界面 */
  const canAutoHide = autoHide && view === 'write' && !reading && !zen && Boolean(doc)

  /**
   * 顶栏和底栏是两套规则，别混在一起：
   * - 底栏 / 侧栏（canAutoHide）：在写作视图里打字才收，鼠标一动就回来；
   * - 顶栏（canHideBar）：窗口已经没有系统标题栏了，它本身变成「备用」的 ——
   *   除了阅读与禅模式，任何时候都默认藏着，只有鼠标够到右上角才滑出来
   *   （窗口按钮在那儿）。这样顶上那条跟界面不搭的边框就彻底消失了。
   */
  const canHideBar = autoHide && !zen && !reading
  const barHidden = canHideBar && !barShown

  /**
   * 侧栏此刻在不在场。
   *
   * 顶栏既然要够到右上角才出来，☰ 就不再是个顺手的入口了 —— 所以侧栏改成
   * 「鼠标贴左边缘自己出来」：靠过去看一眼，走开就还回去，不改变 ☰ 的开关心意。
   * 手动开着（☰）当然也算数，只是在打字收起时同样让位给正文。
   */
  const sidebarShown = sidebarPeek || (sidebarOpen && !barsHidden)

  // 在正文里敲字就把顶栏底栏收起来。
  // 只排除两件事：带修饰键的快捷键、以及在真正的输入框里打字。
  // 这里**不**判断「焦点是不是在编辑器里」—— 中文输入法组词时那个判断不稳定，
  // 会把「打中文」这一整条路漏掉（表现就是打英文能收、打中文不收）。
  useEffect(() => {
    if (!canAutoHide) setBarsHidden(false)
    if (!canHideBar) setBarShown(false)
    if (!canAutoHide && !canHideBar) return

    const hide = () => {
      if (canAutoHide) setBarsHidden(true)
      if (canHideBar) setBarShown(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      hide()
    }
    window.addEventListener('keydown', onKey)
    // 输入法的第一枪是 compositionstart：Windows 上那一下常常没有可用的 keydown，
    // 所以单独听一次，中文才收得起来。
    window.addEventListener('compositionstart', hide)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('compositionstart', hide)
    }
  }, [canAutoHide, canHideBar])

  // 顶栏的进出场：鼠标够到右上角就放出来，离开一会儿再收回去。
  // 判据不自己算坐标，直接问 elementFromPoint「鼠标底下现在是谁」——
  // 顶栏里的下拉菜单（⋯ 更多 / 导出）本身就是顶栏的后代，
  // 所以鼠标一挪到菜单上照样算「还在顶栏里」，不会点着点着顶栏自己收走。
  useEffect(() => {
    if (!canHideBar) return
    let leave = 0
    const onMove = (e: MouseEvent) => {
      const hit = document.elementFromPoint(e.clientX, e.clientY)
      if (hit?.closest('.titlebar, .hot-corner')) {
        if (leave) {
          window.clearTimeout(leave)
          leave = 0
        }
        // 这里不能省着调。打字会把顶栏收掉，可鼠标一点没动 ——
        // 要是记着「已经开过了」就不再置位，鼠标明明还停在右上角，
        // 顶栏却再也不出来了。（这个坑实装过一次。）
        setBarShown(true)
        return
      }
      if (leave) return
      // 留 420ms 缓冲：手从右上角往编辑器里划的时候，别让顶栏一路跟着闪
      leave = window.setTimeout(() => {
        leave = 0
        setBarShown(false)
      }, 420)
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      if (leave) window.clearTimeout(leave)
    }
  }, [canHideBar])

  // 鼠标贴到窗口左边缘就把侧栏放出来，走开再还回去。
  // 判据用坐标而不是元素：无边框窗口最左边那几像素归系统的缩放边框管
  // （WM_NCHITTEST 直接吃掉，WebView 压根收不到鼠标事件），
  // 所以留 16px 余量 —— 等事件递到手里时，鼠标早就够得着了。
  useEffect(() => {
    if (!canHideBar) {
      setSidebarPeek(false)
      return
    }
    let leave = 0
    const onMove = (e: MouseEvent) => {
      const hit = document.elementFromPoint(e.clientX, e.clientY)
      const on = e.clientX <= 16 || Boolean(hit?.closest('.sidebar'))
      if (on) {
        if (leave) {
          window.clearTimeout(leave)
          leave = 0
        }
        setSidebarPeek(true)
        return
      }
      if (leave) return
      leave = window.setTimeout(() => {
        leave = 0
        setSidebarPeek(false)
      }, 420)
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      if (leave) window.clearTimeout(leave)
    }
  }, [canHideBar])

  // 鼠标一动就放回来。收起之后留 400ms 冷静期 ——
  // 否则手搭在鼠标上轻微一抖，界面就自己弹回去了。
  useEffect(() => {
    if (!canAutoHide || !barsHidden) return
    let armed = false
    const timer = window.setTimeout(() => {
      armed = true
    }, 400)
    const wake = () => {
      if (armed) setBarsHidden(false)
    }
    window.addEventListener('mousemove', wake)
    window.addEventListener('mousedown', wake)
    window.addEventListener('wheel', wake, { passive: true })
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('mousedown', wake)
      window.removeEventListener('wheel', wake)
    }
  }, [canAutoHide, barsHidden])
  /** 桌面行为偏好（托盘 / 自启 / 自动同步）—— 存在 Rust 侧，因为托盘事件发生在前端之外 */
  const [desk, setDesk] = useState<DesktopPrefs>(DEFAULT_PREFS)
  /** 开机自启是系统里的事实，不是我们的设置，所以单独读一次 */
  const [autostart, setAutostartOn] = useState(false)
  /** 当前文档的批注（存 .quill-meta.json，不进 .md） */
  const [comments, setComments] = useState<Comment[]>([])
  const [commentsOpen, setCommentsOpen] = useState(false)
  /** 从正文选中带进面板的新建草稿（引文） */
  const [commentDraft, setCommentDraft] = useState<string | null>(null)
  /** 从正文点底纹进来时要高亮的那条 */
  const [commentFocus, setCommentFocus] = useState<string | null>(null)

  const docRef = useRef<Doc | null>(null)
  const liveRef = useRef<{ title: string; content: JSONContent } | null>(null)
  const timerRef = useRef<number | null>(null)
  const lastCharsRef = useRef(0)
  /** 当前编辑器实例（复制富文本等要用） */
  const editorRef = useRef<Editor | null>(null)
  /**
   * 同一份实例的 state 版本。
   *
   * ref 变了不会触发重渲染，而思维导图得在编辑器就绪后拿到它才能编辑 ——
   * 所以额外存一份 state，仅为让它有机会重新渲染一次。
   */
  const [liveEditor, setLiveEditor] = useState<Editor | null>(null)

  /**
   * 全文搜索点进来之后要落到具体那一处，跳转请求先记在这儿。
   *
   * 之所以要「记下来等一等」：点了结果之后文档才刚开始换，
   * 编辑器是新的、内容还没灌进去。等 onReady 到了再跳才落得准。
   */
  const pendingJumpRef = useRef<{ file: string; query: string; nth: number } | null>(null)

  const handleEditorReady = useCallback((ed: Editor) => {
    editorRef.current = ed
    setLiveEditor(ed)

    const jump = pendingJumpRef.current
    if (!jump) return
    pendingJumpRef.current = null
    // 编辑器就绪时文档未必已经切过去了，对不上就放弃这一跳（别跳到别的文章里去）
    if (docRef.current?.id !== jump.file) return
    // 再等一拍：onReady 之后内容才灌进编辑器，这时候扫才是全的
    window.setTimeout(() => {
      if (ed.isDestroyed) return
      jumpToNth(ed, jump.query, jump.nth)
    }, 200)
  }, [])

  /** 复制为富文本：粘到公众号 / Word 里格式还在 */
  const copyRichText = useCallback(async () => {
    const ed = editorRef.current
    if (!ed || ed.isDestroyed) {
      toast.info('先打开一篇文档')
      return
    }
    try {
      const html = ed.getHTML()
      const text = ed.getText()
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ])
      toast.success('已复制为富文本', '粘到公众号 / Word 里格式还在')
    } catch (err) {
      toast.error('复制失败', String(err).slice(0, 120))
    }
  }, [])

  /* ---------------- 持久化 ---------------- */

  const persist = useCallback(async () => {
    const base = docRef.current
    const live = liveRef.current
    if (!base || !live) return
    const candidate: Doc = {
      ...base,
      title: live.title,
      content: live.content,
      updatedAt: Date.now(),
    }
    try {
      const { id } = await storage.put(candidate)
      const next = { ...candidate, id }
      docRef.current = next
      const meta = toMeta(next)
      setDocs((prev) => sortDocs([meta, ...prev.filter((m) => m.id !== meta.id && m.id !== base.id)]))
      setDoc(next)
      setSaving('saved')
      // 记一笔今日写作量（热力图）
      const now = countChars(live.content)
      const delta = now - lastCharsRef.current
      lastCharsRef.current = now
      if (delta > 0) {
        void storage
          .recordWriting(todayKey(), delta)
          .then(() => storage.writingStats())
          .then(setStats)
          .catch(() => {})
      }
    } catch (err) {
      console.error('保存失败', err)
      toast.error('保存失败', String(err))
      setSaving('idle')
    }
  }, [])

  const scheduleSave = useCallback(() => {
    setSaving('saving')
    if (timerRef.current) window.clearTimeout(timerRef.current)
    // 停手 1.4 秒才落盘。之前是 650ms —— 打字稍微一顿就写一次盘、跟着一次 git 提交，
    // 一天下来提交历史被切得稀碎；更要命的是保存瞬间的重渲染会打断输入法组词，
    // 中文写到一半光标就跳走了。
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void persist()
    }, 1400)
  }, [persist])

  const flush = useCallback(async () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    await persist()
  }, [persist])

  /* ---------------- 初始化 ---------------- */

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const store = await initStorage()
      if (cancelled) return
      setVaultMode(store.kind === 'vault')
      setVaultLabel(store.label)

      // 让编辑器能把文档里的 assets/xxx 换成 WebView 能取的 URL
      if (store.kind === 'vault') {
        try {
          const { convertFileSrc } = await import('@tauri-apps/api/core')
          const base = store.label
          setAssetResolver((rel) => convertFileSrc(`${base}\\${rel.replace(/\//g, '\\')}`))
        } catch {
          /* 浏览器模式没有这个 API */
        }
      }

      let list = await store.list()
      if (!list.length) {
        const fresh = await store.create('欢迎使用 Quill')
        await store.put({ ...fresh, content: WELCOME })
        list = await store.list()
      }
      if (cancelled) return
      setDocs(list)
      void store
        .allTags()
        .then((t) => !cancelled && setAllTags(t))
        .catch(() => {})
      void store
        .writingStats()
        .then((s) => !cancelled && setStats(s))
        .catch(() => {})

      const first = await store.get(list[0].id)
      if (first && !cancelled) {
        docRef.current = first
        liveRef.current = { title: first.title, content: first.content }
        lastCharsRef.current = countChars(first.content)
        setDoc(first)
        setSessionKey((k) => k + 1)
      }
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 主题落盘与应用都走 core/theme，和便签、磁贴用的是同一套
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    applyProse(prose)
    saveProse(prose)
  }, [prose])

  /* 桌面版：托盘行为偏好与开机自启（浏览器模式整段跳过） */
  useEffect(() => {
    if (!isDesktop()) return
    void (async () => {
      setDesk(await loadDesktopPrefs())
      setAutostartOn(await autostartEnabled())
    })()
  }, [])

  const applyDesk = useCallback((next: DesktopPrefs) => {
    setDesk(next)
    void saveDesktopPrefs(next).catch((err) => toast.error('设置保存失败', String(err)))
  }, [])

  const applyAutostart = useCallback((next: boolean) => {
    setAutostartOn(next)
    void setAutostart(next)
      .then(() => toast.info(next ? '已开启开机自启' : '已关闭开机自启'))
      .catch((err) => {
        setAutostartOn(!next)
        toast.error('开机自启设置失败', String(err).slice(0, 120))
      })
  }, [])

  /**
   * 阅读模式 = 编辑器转只读。
   * 直接操作编辑器实例，不惊动 EditorPane；sessionKey 变化时编辑器会重建并重新报到，
   * 所以依赖里带上它，切文档后重新套用一次。
   */
  useEffect(() => {
    const ed = editorRef.current
    if (!ed || ed.isDestroyed) return
    ed.setEditable(!reading)
    if (reading) ed.commands.blur()
  }, [reading, sessionKey])

  /* ---------------- 批注 ---------------- */

  // 换文档时读一次批注
  useEffect(() => {
    const id = doc?.id
    if (!id || !storage.comments) {
      setComments([])
      return
    }
    let alive = true
    void storage
      .comments(id)
      .then((list) => {
        if (alive) setComments(list)
      })
      .catch(() => {
        if (alive) setComments([])
      })
    return () => {
      alive = false
    }
  }, [doc?.id])

  // 灌进编辑器的 decoration（编辑器重建后也要重来一次）
  useEffect(() => {
    const ed = editorRef.current
    if (ed && !ed.isDestroyed) applyComments(ed, comments)
  }, [comments, sessionKey])

  // 点正文里的批注底纹 → 打开面板并定位
  useEffect(() => {
    onCommentPick((id) => {
      setCommentFocus(id)
      setCommentsOpen(true)
    })
    return () => onCommentPick(null)
  }, [])

  /* ---------------- 自动更新 ---------------- */

  /**
   * 启动后静默查一次有没有新版：有才提示，查不到（没网、代理拦了）就当无事发生。
   * 延迟 8 秒是别跟界面初始化抢那点启动时间。
   */
  useEffect(() => {
    if (!isDesktop()) return
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const info = await checkUpdate()
          if (info) toast.info(`有新版本 ${info.version}`, '在「设置 → 关于」里可以更新')
        } catch {
          /* 静默：网络不通不该打扰写作 */
        }
      })()
    }, 8000)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void flush()
      }
      // Ctrl+Shift+A：问这篇文档
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setChatOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flush])

  // 设置界面按 Esc 返回
  useEffect(() => {
    if (!settingsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 正在输入框里按 Esc 就不抢，交给输入框自己处理
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      setSettingsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen])

  /* ---------------- 文档操作 ---------------- */
  const openDoc = useCallback(
    async (id: string) => {
      await flush()
      const next = await storage.get(id)
      if (!next) return
      docRef.current = next
      liveRef.current = { title: next.title, content: next.content }
      lastCharsRef.current = countChars(next.content)
      setDoc(next)
      setSessionKey((k) => k + 1)
      setSaving('idle')
      setView('write')
    },
    [flush],
  )

  const createNew = useCallback(
    async (templateId = 'blank') => {
      await flush()
      const tpl = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0]
      const fresh = await storage.create(tpl.id === 'blank' ? '未命名' : tpl.name)
      const withBody = { ...fresh, content: tpl.build() }
      await storage.put(withBody)
      docRef.current = withBody
      liveRef.current = { title: withBody.title, content: withBody.content }
      lastCharsRef.current = countChars(withBody.content)
      setDoc(withBody)
      setDocs((prev) => sortDocs([toMeta(withBody), ...prev]))
      setSessionKey((k) => k + 1)
      setView('write')
      setSaving('idle')
      toast.success('已新建', tpl.name)
    },
    [flush],
  )

  /** Ctrl+D：跳到今天的日记，没有就按「日记」模板建一篇 */
  const dailyNote = useCallback(async () => {
    const key = todayKey()
    try {
      const list = await storage.list()
      const hit = list.find((d) => d.title === key)
      if (hit) {
        await openDoc(hit.id)
        toast.info('今天的日记', key)
        return
      }
      await flush()
      const tpl = TEMPLATES.find((t) => t.id === 'daily') ?? TEMPLATES[0]
      const fresh = await storage.create(key)
      const withBody = { ...fresh, content: tpl.build() }
      await storage.put(withBody)
      docRef.current = withBody
      liveRef.current = { title: withBody.title, content: withBody.content }
      lastCharsRef.current = countChars(withBody.content)
      setDoc(withBody)
      setDocs((prev) => sortDocs([toMeta(withBody), ...prev]))
      setSessionKey((k) => k + 1)
      setView('write')
      setSaving('idle')
      toast.success('已新建今天的日记', key)
    } catch (err) {
      toast.error('日记打开失败', String(err).slice(0, 120))
    }
  }, [flush, openDoc])

  // 全局快捷键（放在 createNew 之后，避免 TDZ）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === '/') {
        e.preventDefault()
        setShortcutsOpen((v) => !v)
        return
      }
      if (key === 'n') {
        e.preventDefault()
        void createNew('blank')
        return
      }
      if (key === 'd') {
        e.preventDefault()
        void dailyNote()
        return
      }
      if (key === '\\') {
        e.preventDefault()
        setSidebarOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [createNew, dailyNote])

  /** 阅读模式：只读通读，写完回头看的时候用（F9 切换） */
  const toggleReading = useCallback(() => setReading((v) => !v), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F9') return
      e.preventDefault()
      toggleReading()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleReading])

  /* ---------------- 禅模式（F11） ---------------- */

  const zenRef = useRef(false)
  useEffect(() => {
    zenRef.current = zen
  }, [zen])

  /**
   * 禅模式：窗口切真全屏 + 藏掉标题栏 / 侧栏 / 状态栏，只剩正文。
   * 全屏失败（被系统拒、浏览器没权限）也不影响 —— 界面该隐的还是隐。
   */
  const toggleZen = useCallback(() => {
    const next = !zenRef.current
    setZen(next)
    void (async () => {
      try {
        if (isDesktop()) {
          const { getCurrentWindow } = await import('@tauri-apps/api/window')
          await getCurrentWindow().setFullscreen(next)
        } else if (next) {
          await document.documentElement.requestFullscreen()
        } else if (document.fullscreenElement) {
          await document.exitFullscreen()
        }
      } catch {
        /* 全屏没切成也照常进出禅模式 */
      }
    })()
  }, [])

  // 走捕获阶段：抢在 WebView 自己处理 F11 全屏之前
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F11') return
      e.preventDefault()
      e.stopPropagation()
      toggleZen()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [toggleZen])

  // 用别的方式退出全屏（Win+↓、Esc、系统快捷键）时，跟着退出禅模式
  useEffect(() => {
    if (!zen || !isDesktop()) return
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window')
          if (!(await getCurrentWindow().isFullscreen())) setZen(false)
        } catch {
          /* 取不到就当没变 */
        }
      })()
    }, 1500)
    return () => window.clearInterval(timer)
  }, [zen])

  const removeDoc = useCallback(
    async (id: string) => {
      const target = docs.find((d) => d.id === id)
      const removingCurrent = docRef.current?.id === id

      // 关键：先掐掉待保存的定时器、清空「当前文档」指针。
      // 否则接下来 openDoc() 里的 flush()（以及 650ms 防抖保存）会把刚删掉的
      // 文件原样写回去 —— 表现就是「删了又自己冒出来」。
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (removingCurrent) {
        docRef.current = null
        liveRef.current = null
      }

      await storage.remove(id)
      toast.success('已删除', target?.title ?? id)

      const rest = docs.filter((d) => d.id !== id)
      setDocs(rest)
      if (removingCurrent) {
        setSaving('idle')
        if (rest.length) {
          await openDoc(rest[0].id)
        } else {
          setDoc(null)
          setSessionKey((k) => k + 1)
        }
      }
    },
    [docs, openDoc],
  )

  const toggleStar = useCallback(
    async (id: string) => {
      const meta = docs.find((d) => d.id === id)
      if (!meta) return
      const starred = !meta.starred
      setDocs((prev) => prev.map((m) => (m.id === id ? { ...m, starred } : m)))
      if (docRef.current?.id === id) {
        docRef.current = { ...docRef.current, starred }
        setDoc((d) => (d ? { ...d, starred } : d))
      }
      await storage.star(id, starred)
    },
    [docs],
  )

  const setTagsFor = useCallback(async (id: string, next: string[]) => {
    setDocs((prev) => prev.map((m) => (m.id === id ? { ...m, tags: next } : m)))
    if (docRef.current?.id === id) {
      docRef.current = { ...docRef.current, tags: next }
      setDoc((d) => (d ? { ...d, tags: next } : d))
    }
    try {
      await storage.setTags(id, next)
      setAllTags(await storage.allTags())
    } catch (err) {
      toast.error('标签保存失败', String(err))
    }
  }, [])

  /** 把当前文档钉成桌面磁贴 */
  const pinToDesktop = useCallback(async () => {
    const d = docRef.current
    if (!d) return
    try {
      await openSticky(d.id, d.title)
      toast.success('已钉到桌面', d.title)
    } catch (err) {
      toast.error('钉住失败', String(err))
    }
  }, [])

  const refreshDocs = useCallback(async () => {
    try {
      setDocs(await storage.list())
      setAllTags(await storage.allTags())
    } catch {
      /* 忽略 */
    }
  }, [])

  /* ---------------- 批注操作 ---------------- */

  const saveComment = useCallback((next: Comment) => {
    const id = docRef.current?.id
    if (!id) return
    setComments((prev) => {
      const exists = prev.some((c) => c.id === next.id)
      const list = exists ? prev.map((c) => (c.id === next.id ? next : c)) : [...prev, next]
      void storage
        .setComments?.(id, list)
        .catch((err) => toast.error('批注没存上', String(err).slice(0, 120)))
      return list
    })
  }, [])

  const removeComment = useCallback((cid: string) => {
    const id = docRef.current?.id
    if (!id) return
    setComments((prev) => {
      const list = prev.filter((c) => c.id !== cid)
      void storage
        .setComments?.(id, list)
        .catch((err) => toast.error('批注没删掉', String(err).slice(0, 120)))
      return list
    })
  }, [])

  /** 跳回批注锚定的那段文字；正文改过就按引文重新找 */
  const jumpToComment = useCallback((c: Comment) => {
    const ed = editorRef.current
    if (!ed || ed.isDestroyed) return
    const at = locate(ed.state.doc, c.quote)
    if (!at) {
      toast.info('原文已经改动了', '这条批注暂时找不到落脚点')
      return
    }
    ed.chain().focus().setTextSelection({ from: at.from, to: at.to }).run()
    try {
      const node = ed.view.domAtPos(at.from).node
      const el = node instanceof HTMLElement ? node : node.parentElement
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    } catch {
      /* 定位失败就算了，选区已经落过去了 */
    }
  }, [])

  /** 快速捕获：把一句话追加进「收件箱」文档 */
  const quickCapture = useCallback(
    async (text: string) => {
      try {
        const list = await storage.list()
        let target = list.find((d) => d.title === '收件箱')
        if (!target) {
          const fresh = await storage.create('收件箱')
          const saved = await storage.put(fresh)
          target = { ...toMeta(fresh), id: saved.id }
        }
        const doc = await storage.get(target.id)
        if (!doc) throw new Error('收件箱读取失败')
        const stamp = new Date().toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
        })
        const item: JSONContent = {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: `${stamp}  ${text}` }],
                },
              ],
            },
          ],
        }
        const content: JSONContent = {
          type: 'doc',
          content: [...(doc.content.content ?? []), item],
        }
        await storage.put({ ...doc, content, updatedAt: Date.now() })
        toast.success('已记一笔', '收件箱')
        await refreshDocs()
      } catch (err) {
        toast.error('保存失败', String(err))
      }
    },
    [refreshDocs],
  )

  // 桌面版：全局快捷键唤起时，Rust 侧会发这个事件
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return
    let unlisten: (() => void) | undefined
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        unlisten = await listen('quill:quick-capture', () => setQuickOpen(true))
      } catch {
        /* 浏览器模式没有 Tauri API */
      }
    })()
    return () => unlisten?.()
  }, [])

  /* ---------------- 编辑回调 ---------------- */

  const onTitle = useCallback(
    (title: string) => {
      if (!liveRef.current) return
      liveRef.current.title = title
      setDoc((d) => (d ? { ...d, title } : d))
      scheduleSave()
    },
    [scheduleSave],
  )

  const onChange = useCallback(
    (content: JSONContent) => {
      if (!liveRef.current) return
      liveRef.current.content = content
      scheduleSave()
    },
    [scheduleSave],
  )

  const switchView = useCallback((next: ViewMode) => {
    if (next === 'mindmap') {
      setMapSnap({
        content: liveRef.current?.content ??
          docRef.current?.content ?? { type: 'doc', content: [] },
        title: liveRef.current?.title ?? docRef.current?.title ?? '未命名',
      })
    }
    setView(next)
  }, [])

  const exportMd = useCallback(() => {
    const live = liveRef.current
    if (!live) return
    download(
      `${safeFileName(live.title)}.md`,
      docToMarkdown(live.content, live.title),
      'text/markdown',
    )
    toast.success('已导出 Markdown', `${safeFileName(live.title)}.md`)
  }, [])

  const exportJson = useCallback(() => {
    const live = liveRef.current
    if (!live || !docRef.current) return
    const payload = { ...docRef.current, title: live.title, content: live.content }
    download(`${safeFileName(live.title)}.json`, JSON.stringify(payload, null, 2), 'application/json')
  }, [])

  /** 导出单文件 HTML：样式全内联，直接发出去别人也能看 */
  const exportHtml = useCallback(() => {
    const ed = editorRef.current
    const live = liveRef.current
    if (!ed || ed.isDestroyed || !live) return
    const name = `${safeFileName(live.title)}.html`
    download(name, buildStandaloneHtml(live.title, ed.getHTML()), 'text/html')
    toast.success('已导出 HTML', name)
  }, [])

  /**
   * 导出 PDF：走系统打印，在打印机列表里选「Microsoft Print to PDF」。
   * 不引 jsPDF 那一类库 —— 它们是截图拼的，中文和排版都会糊；
   * 系统打印出的是矢量文本，还能选中复制。
   */
  const exportPdf = useCallback(() => {
    if (!docRef.current) return
    toast.info('在打印窗口的打印机里选「Microsoft Print to PDF」', '另存为 PDF')
    window.setTimeout(() => window.print(), 120)
  }, [])

  /** 把选出来的文件真正导进去 —— .txt 在读的时候就已经转成 Markdown 了 */
  const runImport = useCallback(
    async (files: FileList | null) => {
      if (!files || !files.length) return
      try {
        const items = await readMarkdownFolder(files)
        if (!items.length) {
          toast.info('没找到能导入的文本', '支持 .md / .markdown / .txt')
          return
        }
        const n = await importMarkdown(items)
        await refreshDocs()
        toast.success(`已导入 ${n} 篇文档`, '同名文件会自动加序号，不会覆盖')
      } catch (err) {
        toast.error('导入失败', String(err).slice(0, 120))
      }
    },
    [refreshDocs],
  )

  /**
   * 打开系统的文件选择框。
   * dir = true 选整个文件夹（搬 Obsidian / Notion 的库），false 挑几个文件。
   */
  const pickFiles = useCallback(
    (dir: boolean) => {
      if (!isDesktop()) {
        toast.info('导入只在桌面版可用')
        return
      }
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      if (dir) {
        input.setAttribute('webkitdirectory', '')
        input.setAttribute('directory', '')
      } else {
        input.accept = '.txt,.text,.md,.markdown,text/plain'
      }
      input.onchange = () => void runImport(input.files)
      input.click()
    },
    [runImport],
  )

  /** 选一个文件夹，把里面的 Markdown 全搬进来（Obsidian / Notion 导出的就是这种） */
  const importFolder = useCallback(() => pickFiles(true), [pickFiles])

  /** 挑几个文本文件导进来；.txt 会自动识别编码并转成 Markdown */
  const importFiles = useCallback(() => pickFiles(false), [pickFiles])

  /* ---------------- 标题栏的「⋯ 更多」 ---------------- */

  const toggleFocus = useCallback(() => {
    const next = !focusMode
    setFocusMode(next)
    toast.info(next ? '专注模式已开：只亮当前段落' : '专注模式已关')
  }, [focusMode, setFocusMode])

  const toggleTypewriter = useCallback(() => {
    const next = !typewriter
    setTypewriter(next)
    toast.info(next ? '打字机模式已开：光标锁定视口' : '打字机模式已关')
  }, [typewriter, setTypewriter])

  const moreItems: MenuItem[] = [
    { key: 'md', icon: '⇩', label: '导出 Markdown', hint: '.md', disabled: !doc, onSelect: exportMd },
    { key: 'html', icon: '⇩', label: '导出 HTML', hint: '单文件', disabled: !doc, onSelect: exportHtml },
    {
      key: 'pdf',
      icon: '⎙',
      label: '导出 PDF',
      hint: '走系统打印',
      disabled: !doc,
      onSelect: exportPdf,
    },
    { key: 'json', icon: '⇩', label: '导出 JSON', hint: '.json', disabled: !doc, onSelect: exportJson },
    {
      key: 'import',
      icon: '⇧',
      label: '导入文件夹',
      hint: 'Markdown',
      disabled: !vaultMode,
      onSelect: () => void importFolder(),
    },
    {
      key: 'import-files',
      icon: '⇧',
      label: '导入文本文件',
      hint: '.txt / .md',
      disabled: !vaultMode,
      onSelect: () => void importFiles(),
    },
    {
      key: 'reading',
      icon: '▤',
      label: '阅读模式',
      hint: 'F9',
      on: reading,
      disabled: view !== 'write',
      onSelect: toggleReading,
    },
    {
      key: 'zen',
      icon: '⛶',
      label: '禅模式',
      hint: 'F11',
      on: zen,
      disabled: view !== 'write',
      onSelect: toggleZen,
    },
    {
      key: 'richcopy',
      icon: '⧉',
      label: '复制为富文本',
      hint: '含格式',
      disabled: !doc,
      onSelect: () => void copyRichText(),
    },
    {
      key: 'comments',
      icon: '❝',
      label: '批注',
      hint: comments.length ? `${comments.length} 条` : '选中文字后加',
      on: commentsOpen,
      disabled: !doc,
      onSelect: () => setCommentsOpen((v) => !v),
    },
    {
      key: 'history',
      icon: '⏱',
      label: '版本历史',
      hint: vaultMode ? 'git' : '仅桌面版',
      on: historyOpen,
      disabled: !vaultMode || !doc,
      onSelect: () => setHistoryOpen((v) => !v),
    },
    {
      key: 'focus',
      icon: '◉',
      label: '专注模式',
      on: focusMode,
      disabled: view !== 'write',
      onSelect: toggleFocus,
    },
    {
      key: 'typewriter',
      icon: '⇅',
      label: '打字机模式',
      on: typewriter,
      disabled: view !== 'write',
      onSelect: toggleTypewriter,
    },
    {
      key: 'theme',
      icon: themeInfo(theme).icon,
      label: '换个主题',
      hint: `${themeInfo(theme).label} · 共 6 套`,
      divider: true,
      onSelect: cycleTheme,
    },
    {
      key: 'library',
      icon: '▤',
      label: '文档库',
      hint: '浏览与筛选全部文档',
      onSelect: () => setLibraryOpen(true),
    },
    {
      key: 'settings',
      icon: '⚙',
      label: '设置',
      hint: '外观 / 备份 / 更新',
      onSelect: () => setSettingsOpen(true),
    },
    {
      key: 'chat',
      icon: '✦',
      label: '问这篇文档',
      hint: 'Ctrl+Shift+A',
      disabled: !doc,
      onSelect: () => setChatOpen(true),
    },
    {
      key: 'shortcuts',
      icon: '⌘',
      label: '快捷键一览',
      hint: 'Ctrl+/',
      onSelect: () => setShortcutsOpen(true),
    },
  ]

  /* ---------------- 命令面板（Ctrl+P） ---------------- */

  const paletteCommands: PaletteCommand[] = [
    { id: 'new', title: '新建文档', hint: 'Ctrl+N', icon: '＋', run: () => void createNew() },
    { id: 'ask', title: 'AI 问答', hint: 'Ctrl+Shift+A', icon: '✦', run: () => setChatOpen(true) },
    { id: 'write', title: '切到写作视图', icon: '✎', run: () => switchView('write') },
    { id: 'map', title: '切到思维导图', icon: '◈', run: () => switchView('mindmap') },
    { id: 'export-md', title: '导出 Markdown', hint: '.md', icon: '⇩', run: exportMd },
    { id: 'export-html', title: '导出单文件 HTML', hint: '.html', icon: '⇩', run: exportHtml },
    { id: 'export-pdf', title: '导出 PDF', hint: '系统打印', icon: '⎙', run: exportPdf },
    { id: 'export-json', title: '导出 JSON', hint: '.json', icon: '⇩', run: exportJson },
    { id: 'import', title: '从文件夹导入 Markdown', icon: '⇧', run: () => void importFolder() },
    {
      id: 'import-files',
      title: '导入文本文件',
      hint: '.txt 自动转 Markdown',
      icon: '⇧',
      run: () => void importFiles(),
    },
    { id: 'daily', title: '今天的日记', hint: 'Ctrl+D', icon: '☀', run: () => void dailyNote() },
    { id: 'reading', title: '阅读模式', hint: 'F9', icon: '▤', run: toggleReading },
    { id: 'zen', title: '禅模式', hint: 'F11', icon: '⛶', run: toggleZen },
    {
      id: 'comments',
      title: '批注',
      hint: comments.length ? `${comments.length} 条` : '选中文字后加',
      icon: '❝',
      run: () => setCommentsOpen(true),
    },
    { id: 'richcopy', title: '复制为富文本', icon: '⧉', run: () => void copyRichText() },
    {
      id: 'theme',
      title: '换个主题',
      hint: `${themeInfo(theme).label} · 下一个：${themeInfo(nextTheme(theme)).label}`,
      icon: themeInfo(theme).icon,
      run: cycleTheme,
    },
    { id: 'sidebar', title: '收起 / 展开侧栏', hint: 'Ctrl+\\', icon: '▤', run: () => setSidebarOpen((v) => !v) },
    { id: 'focus', title: '专注模式', icon: '◉', run: toggleFocus },
    { id: 'typewriter', title: '打字机模式', icon: '⇅', run: toggleTypewriter },
    { id: 'quick', title: '快捷便签', hint: 'Ctrl+Space', icon: '✎', run: () => void openQuickNote() },
    {
      id: 'sticky',
      title: '钉到桌面',
      icon: '📌',
      run: () => void pinToDesktop(),
    },
    { id: 'trash', title: '打开回收站', icon: '🗑', run: () => setTrashOpen(true) },
    { id: 'library', title: '文档库', icon: '▤', run: () => setLibraryOpen(true) },
    { id: 'settings', title: '设置', icon: '⚙', run: () => setSettingsOpen(true) },
    { id: 'shortcuts', title: '快捷键一览', hint: 'Ctrl+/', icon: '⌘', run: () => setShortcutsOpen(true) },
    { id: 'reveal', title: '在资源管理器里打开文档仓库', icon: '🗀', run: () => void storage.reveal() },
  ]

  /** 把 AI 的回答插到正文末尾（走正常内容流，所以会一起保存与提交） */
  const insertToEnd = useCallback(
    (text: string) => {
      const live = liveRef.current
      if (!live) return
      const nodes: JSONContent[] = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }))
      if (!nodes.length) return
      const next: JSONContent = {
        type: 'doc',
        content: [...(live.content.content ?? []), ...nodes],
      }
      onChange(next)
      // 编辑器实例不会自己捡起外部塞进去的内容，换 key 让它重建一次
      setSessionKey((k) => k + 1)
      toast.success('已插到文末')
    },
    [onChange],
  )

  /** 全文搜索里点一条结果：打开那篇文档，并落到那一处 */
  const jumpToHit = useCallback(
    (hit: DocSearchHit, query: string) => {
      // 目标就是当前这一篇：编辑器不会重建，也就等不到 onReady，直接跳
      const ed = editorRef.current
      if (docRef.current?.id === hit.file && ed && !ed.isDestroyed) {
        jumpToNth(ed, query, hit.nth)
        return
      }
      pendingJumpRef.current = { file: hit.file, query, nth: hit.nth }
      void openDoc(hit.file)
    },
    [openDoc],
  )

  /* ---------------- 渲染 ---------------- */

  return (
    <div
      className={
        'app' +
        (reading ? ' reading' : '') +
        (zen ? ' zen' : '') +
        (barsHidden && canAutoHide ? ' bars-hidden' : '') +
        (barHidden ? ' bar-hidden' : '')
      }
    >
      <ToastHost />
      {zen && <div className="zen-hint">F11 退出禅模式</div>}
      {reading && (
        <button className="reading-badge" onClick={toggleReading} title="退出阅读模式 · F9">
          阅读模式 · 点这里退出
        </button>
      )}
      <ShortcutsPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <TrashPanel
        open={trashOpen}
        onClose={() => setTrashOpen(false)}
        onChanged={() => void refreshDocs()}
      />
      <QuickCapture
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        onSubmit={(text) => void quickCapture(text)}
      />
      <CommandPalette docs={docs} commands={paletteCommands} onPickDoc={(id) => void openDoc(id)} />
      <SearchPanel onPick={jumpToHit} />
      <AiChatPanel
        open={chatOpen && Boolean(doc)}
        title={doc?.title ?? ''}
        content={doc?.content ?? null}
        onClose={() => setChatOpen(false)}
        onInsert={insertToEnd}
      />
      {/* 顶栏藏起来之后留在顶部的那两块感应区。
          右上角是主入口（窗口按钮就在那儿）；顶上那条 6px 细边是备用通道 ——
          无边框窗口只能拖标题栏，没有它就没法用鼠标搬动窗口。
          特别注意：细边只认「按下去」，鼠标扫过不算 ——
          不然手从正文往上划一下就闪一条顶栏出来。 */}
      {canHideBar && (
        <div className="titlebar-hot" aria-hidden="true">
          <span
            className="hot-strip"
            data-tauri-drag-region
            onMouseDown={() => setBarShown(true)}
          />
          <span className="hot-corner" />
        </div>
      )}
      <div className="titlebar" data-tauri-drag-region>
        <button
          className="btn ghost icon"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? '收起侧栏' : '展开侧栏'}
        >
          ☰
        </button>
        <div className="brand" data-tauri-drag-region>
          <span className="mark" />
          Quill
        </div>
        {vaultMode && (
          <button
            className="btn ghost icon"
            title={`文档仓库：${vaultLabel} · 点击打开文件夹`}
            onClick={() => void storage.reveal()}
          >
            🗀
          </button>
        )}
        <div className="grow" data-tauri-drag-region />
        <div className="seg">
          <button className={view === 'write' ? 'on' : ''} onClick={() => switchView('write')}>
            写作
          </button>
          <button className={view === 'mindmap' ? 'on' : ''} onClick={() => switchView('mindmap')}>
            导图
          </button>
        </div>
        <button
          className="btn ghost icon"
          onClick={() => void openQuickNote()}
          title="快捷便签 · Ctrl+Space"
        >
          ✎
        </button>
        <button
          className="btn ghost icon"
          onClick={() => void pinToDesktop()}
          title="钉到桌面"
          disabled={!doc}
        >
          📌
        </button>
        <MoreMenu items={moreItems} title="更多操作" />
        <WindowControls />
      </div>

      <div className="body">
        <Sidebar
          docs={docs}
          activeId={doc?.id ?? null}
          hidden={!sidebarShown}
          tags={allTags}
          activeTag={activeTag}
          stats={stats}
          goal={dailyGoal}
          onSelect={(id) => void openDoc(id)}
          onCreate={(templateId) => void createNew(templateId)}
          onDelete={(id) => void removeDoc(id)}
          onStar={(id) => void toggleStar(id)}
          onTagFilter={setActiveTag}
          onOpenTrash={() => setTrashOpen(true)}
          onOpenLibrary={() => setLibraryOpen(true)}
        />

        <div className="main">
          {libraryOpen ? (
            <DocLibrary
              docs={docs}
              currentId={doc?.id ?? null}
              onOpen={(id) => {
                void openDoc(id)
                setLibraryOpen(false)
              }}
              onCreate={() => {
                void createNew()
                setLibraryOpen(false)
              }}
              onClose={() => setLibraryOpen(false)}
              onStar={(id) => void toggleStar(id)}
              onOpenTrash={() => {
                setLibraryOpen(false)
                setTrashOpen(true)
              }}
            />
          ) : settingsOpen ? (
            <SettingsView
              onClose={() => setSettingsOpen(false)}
              theme={theme}
              onTheme={setTheme}
              autoHide={autoHide}
              onAutoHide={(v) => {
                setAutoHide(v)
                applyAutoHide(v)
              }}
              prose={prose}
              onProse={setProse}
              aiEnabled={aiEnabled}
              onAiEnabled={setAiEnabled}
              aiDelay={aiDelay}
              onAiDelay={setAiDelay}
              goal={dailyGoal}
              onGoal={setDailyGoal}
              desk={desk}
              onDesk={applyDesk}
              autostart={autostart}
              onAutostart={applyAutostart}
            />
          ) : !ready ? null : !doc ? (
            <div className="welcome">
              <h2>
                欢迎来到 <em>Quill</em>
              </h2>
              <p>左边还没有文档。新建一篇，用 - 加空格开始列大纲，再点右上角看看导图。</p>
              <button className="btn primary" onClick={() => void createNew()}>
                ＋ 新建文档
              </button>
            </div>
          ) : (
            <>
              {/* 编辑器一直挂着，切到导图只是把它藏起来。
                  如果按视图卸载，editor 会被销毁，导图就没有可编辑的对象了。 */}
              <div className={'main-stack' + (view === 'write' ? '' : ' is-hidden')}>
                <EditorPane
                key={sessionKey}
                doc={doc}
                saving={saving}
                focusMode={focusMode}
                typewriter={typewriter}
                tags={doc.tags ?? []}
                jumpPath={jumpPath}
                onTitle={onTitle}
                onChange={onChange}
                onTags={(next) => void setTagsFor(doc.id, next)}
                onJumpDone={() => setJumpPath(null)}
                allDocs={docs.map((d) => d.title)}
                aiEnabled={aiEnabled}
                aiDelay={aiDelay}
                onOpenDoc={(title) => {
                  const target = docs.find((d) => d.title === title)
                  if (target) void openDoc(target.id)
                  else toast.info('还没有这篇文档', title)
                }}
                onReady={handleEditorReady}
                onComment={(text) => {
                  setCommentFocus(null)
                  setCommentDraft(text)
                  setCommentsOpen(true)
                }}
                />
              </div>
              {view === 'mindmap' && (
                <div className="pane">
                  <MindMap
                    editor={liveEditor}
                    content={mapSnap?.content}
                    title={doc.title}
                    onJump={(path) => {
                      setJumpPath(path)
                      setView('write')
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {historyOpen && doc && (
          <HistoryDrawer
            file={doc.id}
            onClose={() => setHistoryOpen(false)}
            onRestored={() => void openDoc(doc.id)}
          />
        )}

        {commentsOpen && doc && (
          <CommentsPanel
            open={commentsOpen}
            onClose={() => setCommentsOpen(false)}
            comments={comments}
            draft={commentDraft}
            onDraftDone={() => setCommentDraft(null)}
            onSave={saveComment}
            onDelete={removeComment}
            onJump={jumpToComment}
            focusId={commentFocus}
          />
        )}
      </div>

      {/*
        底部状态栏：放「操作级」的信息 —— 保存状态、今日进度、正文栏宽度。
        顶部那行是「文档级」的（修改时间、总字数、段数、阅读时长），两边分工不重复。
      */}
      <div className="statusbar">
        <span
          className={
            'sb-save' + (saving === 'saving' ? ' saving' : saving === 'saved' ? ' saved' : '')
          }
        >
          {saving === 'saving' ? '保存中…' : saving === 'saved' ? '✓ 已保存' : ''}
        </span>

        <span className="sb-item">
          今天 <b>{progress.today}</b> 字
        </span>

        {progress.goal > 0 && (
          <>
            <span className="sb-goal" title={`目标 ${progress.goal} 字`}>
              <span style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
            </span>
            <span className={'sb-item' + (progress.done ? ' done' : '')}>
              {progress.done ? '已达标 ✓' : `还差 ${progress.remain}`}
            </span>
          </>
        )}

        <span className="grow" />

        {/* 反向链接并进底栏，点开向上弹出，不再自己占正文底下的一行 */}
        {doc && (
          <BacklinksPanel
            doc={{ id: doc.id, title: doc.title }}
            docs={docs}
            onOpen={(id) => void openDoc(id)}
          />
        )}

        <label className="width-slider" title="拖动调节正文栏宽度">
          <span className="ws-icon" aria-hidden="true">
            ⇔
          </span>
          <input
            type="range"
            min={PROSE_RANGE.minWidth}
            max={PROSE_RANGE.maxWidth}
            step={PROSE_RANGE.stepWidth}
            value={prose.width}
            aria-label="正文栏宽度"
            onChange={(e) => setProse((p) => ({ ...p, width: clampWidth(Number(e.target.value)) }))}
          />
          <em className="ws-val">{prose.width}</em>
        </label>
      </div>
    </div>
  )
}
