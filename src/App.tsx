import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
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
import CommandPalette from './ui/CommandPalette'
import SearchPanel from './ui/SearchPanel'
import ReaderView from './ui/ReaderView'
import LongformEditor from './ui/LongformEditor'
import TabBar from './ui/TabBar'
import SplitPane from './ui/SplitPane'
import AiChatPanel from './ui/AiChatPanel'
import QuickCapture from './ui/QuickCapture'
import CommentsPanel from './ui/CommentsPanel'
import { applyTheme, nextTheme, readTheme, type Theme } from './core/theme'
import { applyAutoHide } from './core/chrome'
import { goalProgress } from './core/stats'
import { applyProse, readProse, saveProse, type ProseStyle } from './core/fonts'
import type { ViewMode } from './core/types'
import type { HeavyOutline } from './app/types'
import { useChromeBars } from './app/useChromeBars'
import { useZenMode } from './app/useZenMode'
import { useDesktopPrefs } from './app/useDesktopPrefs'
import { useUpdateCheck } from './app/useUpdateCheck'
import { useComments } from './app/useComments'
import { useExportImport } from './app/useExportImport'
import { useEditorBridge } from './app/useEditorBridge'
import { useDocSession } from './app/useDocSession'
import ConflictDialog from './ui/ConflictDialog'
import { parseDocument } from './core/md-parse'
import { useAppShortcuts } from './app/useAppShortcuts'
import { buildMoreItems, buildPaletteCommands } from './app/menus'
import TitleBar from './app/TitleBar'
import StatusBar from './app/StatusBar'

export default function App() {
  const [view, setView] = useState<ViewMode>('write')
  /*
   * 左栏：**默认开着**，和上、下两个栏一起走「鼠标一动就展开、写作时自动收起」。
   * （早先默认收起、靠 ☰ 或贴左边缘唤出，主人后来把规则统一成上面那条。）
   * ☰ 仍然能手动收掉它 —— 那是「我这一会儿不想看见它」，和打字让位是两回事。
   */
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [theme, setTheme] = useState<Theme>(() => readTheme())
  /** 换个主题：标题栏按钮和命令面板共用；按主题清单的顺序往下循环 */
  const cycleTheme = useCallback(() => setTheme((t) => nextTheme(t)), [])
  const [mapSnap, setMapSnap] = useState<{ content: JSONContent; title: string } | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [focusMode, setFocusMode] = useSetting('focus-mode', false)
  const [typewriter, setTypewriter] = useSetting('typewriter', false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [jumpPath, setJumpPath] = useState<number[] | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /**
   * 右侧栏：外观这类「边看边调」的设置放这儿，调的时候不用离开正文。
   *
   * **鼠标靠近右边缘才打开**（asidePeek），默认不占地方 ——
   * 它常驻的话会把正文挤窄 320px，写作时很亏。
   * 🎛 按钮和栏里自带的 ✕ 是手动开关，管的是 asideOpen；
   * 临时摸一下右边缘不开这个开关，走开就还回去（和左栏当年的 peek 一个路子）。
   */
  const [asideOpen, setAsideOpen] = useState(false)
  /**
   * 超大文档：只揣一份章节目录，正文交给 ReaderView 按章现取。
   *
   * 刻意**不复用 `doc`** —— 那篇根本解析不成 JSONContent（二十多万个块）。
   * 但渲染走的还是同一个 ReaderView，所以界面跟普通小说一模一样。
   */
  const [heavyOutline, setHeavyOutline] = useState<HeavyOutline | null>(null)
  /**
   * 长文本模式：和普通界面**同一个壳**，只是加载策略不同 ——
   * 一次只挂当前章和前后各一章，其余按字节数占位。
   */
  const [longform, setLongform] = useState<{ id: string; title: string } | null>(null)
  /**
   * 标签页：只是「打开过哪几篇」的序列。
   * 每篇的内容状态仍然只在 useDocSession 里 —— 标签不复制一份数据。
   */
  const [tabs, setTabs] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('quill:tabs')
      const arr = raw ? (JSON.parse(raw) as unknown) : []
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  })
  /** 分屏右栏对照哪一篇（null = 不分屏） */
  const [splitId, setSplitId] = useState<string | null>(null)
  /** 小说阅读视图：左边章节目录，右边正文按栏排（跟编辑模式完全分开，只读） */
  const [readerOpen, setReaderOpen] = useState(false)
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
  /** 阅读模式：只读、收起干扰，用来回头通读 */
  const [reading, setReading] = useState(false)

  /** 进长文本模式：只记文件与标题，正文交给 LongformEditor 按章现取 */
  const openLongform = useCallback((file: string, title: string) => {
    setLongform({ id: file, title })
  }, [])

  const {
    docs,
    doc,
    saving,
    ready,
    vaultMode,
    vaultLabel,
    allTags,
    stats,
    sessionKey,
    docRef,
    liveRef,
    flush,
    openDoc,
    openInEditor,
    createNew,
    editChapterFromReader,
    dailyNote,
    removeDoc,
    toggleStar,
    setTagsFor,
    pinToDesktop,
    refreshDocs,
    quickCapture,
    onTitle,
    onChange,
    insertToEnd,
    conflict,
    keepMine,
    takeDisk,
    adoptRename,
    saveAsNew,
    laterConflict,
    clearConflict,
    reopenConflict,
    forcePersist,
  } = useDocSession({ setView, heavyOutline, setHeavyOutline, setReaderOpen, openLongform })

  /** 打开一篇并把它挂进标签栏（已经在标签里就只是切过去） */
  const openInTab = useCallback(
    (id: string) => {
      setTabs((prev) => (prev.includes(id) ? prev : [...prev, id]))
      void openDoc(id)
    },
    [openDoc],
  )

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const next = prev.filter((x) => x !== id)
        // 关的是当前这篇：顺手切到还开着的最后一篇
        if (docRef.current?.id === id) {
          const fallback = next[next.length - 1]
          if (fallback) void openDoc(fallback)
        }
        return next
      })
      setSplitId((cur) => (cur === id ? null : cur))
    },
    [openDoc],
  )


  // 底部状态栏要用：今日写了多少、离目标还差多少
  const progress = useMemo(() => goalProgress(stats, dailyGoal), [stats, dailyGoal])

  const { zen, toggleZen } = useZenMode()
  const { autoHide, setAutoHide, barsHidden, barsPinned, asidePeek, canAutoHide } = useChromeBars({
    view,
    reading,
    zen,
    hasDoc: Boolean(doc),
  })
  /*
   * 全屏页（设置 / 文档库）打开时右栏必须让位。
   * 不然同一份设置会在「主区」和「右栏」各画一遍 —— 右边那份还是嵌在窄栏里的形态，
   * 看起来就像重复了一块。
   */
  const asideShown = (asideOpen || asidePeek) && !settingsOpen && !libraryOpen
  const sidebarShown = sidebarOpen && !barsHidden

  const { editorRef, liveEditor, handleEditorReady, jumpToHit } = useEditorBridge({
    docRef,
    openDoc,
  })

  /**
   * 冲突处理：两边都留。
   *
   * 为什么不真做一个合并编辑器：长文档里三路合并的界面成本远高于一次
   * 「先都留下、再慢慢删」，而这条路的**内容零丢失**，收拾起来心里有底。
   */
  const resolveMerge = useCallback(async () => {
    const ed = editorRef?.current
    if (!ed || ed.isDestroyed || !conflict?.disk) return
    const blocks = parseDocument(conflict.disk).doc.content ?? []
    ed.chain()
      .focus('end')
      .insertContent([
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '———— 以下是磁盘上被外部改过的版本 ————' }],
        },
        ...blocks,
      ])
      .run()
    const ok = await forcePersist()
    if (!ok) return
    clearConflict()
    toast.success('两份都已保留', '磁盘版本接在文末 · 已按你的版本保存')
  }, [conflict, clearConflict, forcePersist])

  const {
    comments,
    commentsOpen,
    setCommentsOpen,
    setCommentDraft,
    commentDraft,
    setCommentFocus,
    commentFocus,
    saveComment,
    removeComment,
    jumpToComment,
  } = useComments({ docRef, editorRef, docId: doc?.id, sessionKey })
  const {
    copyRichText,
    exportMd,
    exportJson,
    exportHtml,
    exportPdf,
    runImport,
    importFolder,
    importFiles,
    importPaths,
  } = useExportImport({ docRef, liveRef, editorRef, refreshDocs })
  const { desk, autostart, applyDesk, applyAutostart } = useDesktopPrefs()
  useUpdateCheck()

  // 标签栏记在本地：下次打开还是那几篇（不存在的会在下面被剔掉）
  useEffect(() => {
    try {
      localStorage.setItem('quill:tabs', JSON.stringify(tabs))
    } catch {
      /* 存不下就算了，不影响使用 */
    }
  }, [tabs])

  // 文档列表变了：把已经不存在的标签剔掉（删掉的、改名的）
  useEffect(() => {
    if (!docs.length) return
    setTabs((prev) => prev.filter((id) => docs.some((d) => d.id === id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs.length])

  // 当前打开的是哪篇，标签栏里就得有它（启动自动打开、侧栏点开都走这儿）
  useEffect(() => {
    const id = doc?.id
    if (!id) return
    setTabs((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }, [doc?.id])

  // 主题落盘与应用都走 core/theme，和便签、磁贴用的是同一套
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    applyProse(prose)
    saveProse(prose)
  }, [prose])

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

  /*
   * 设置面板只有这一份。
   *
   * 全屏「设置」页和右侧栏用的是**同一个组件、同一组 props** ——
   * 复制一份的话，以后加个设置项就会漏掉一边（本项目在这上面栽过两次，
   * 阅读视图和批注各一次，两次都是主人自己看出来的）。
   */
  const settingsProps = {
    theme,
    onTheme: setTheme,
    autoHide,
    onAutoHide: (v: boolean) => {
      setAutoHide(v)
      applyAutoHide(v)
    },
    prose,
    onProse: setProse,
    aiEnabled,
    onAiEnabled: setAiEnabled,
    aiDelay,
    onAiDelay: setAiDelay,
    goal: dailyGoal,
    onGoal: setDailyGoal,
    desk,
    onDesk: applyDesk,
    autostart,
    onAutostart: applyAutostart,
  }

  /** 收起右栏（右栏里自带的 ✕ 用它）—— 只管手动开关，不往本地记 */
  const closeAside = useCallback(() => {
    setAsideOpen(false)
  }, [])

  /** 阅读模式：只读通读，写完回头看的时候用（F9 切换） */
  const toggleReading = useCallback(() => setReading((v) => !v), [])

  useAppShortcuts({
    flush,
    createNew,
    dailyNote,
    toggleReading,
    settingsOpen,
    setSettingsOpen,
    setChatOpen,
    setShortcutsOpen,
    setSidebarOpen,
  })

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

  const menuCtx = {
    hasDoc: Boolean(doc),
    vaultMode,
    view,
    reading,
    zen,
    commentCount: comments.length,
    commentsOpen,
    historyOpen,
    focusMode,
    typewriter,
    theme,
    createNew,
    dailyNote,
    switchView,
    pinToDesktop,
    exportMd,
    exportHtml,
    exportPdf,
    exportJson,
    importFolder,
    importFiles,
    copyRichText,
    toggleReading,
    toggleZen,
    enterLongform: () => {
      const cur = docRef.current
      if (cur) openLongform(cur.id, cur.title)
    },
    toggleFocus,
    toggleTypewriter,
    cycleTheme,
    setReaderOpen,
    setCommentsOpen,
    setHistoryOpen,
    setLibraryOpen,
    setSettingsOpen,
    setChatOpen,
    setShortcutsOpen,
    setSidebarOpen,
    setTrashOpen,
  }
  const moreItems = buildMoreItems(menuCtx)
  const paletteCommands = buildPaletteCommands(menuCtx)

  /* ---------------- 渲染 ---------------- */

  return (
    <div
      className={
        'app' +
        (reading ? ' reading' : '') +
        (zen ? ' zen' : '') +
        /* 阅读视图盖上来的时候，底下这一层要跟着往后缩 —— 见 style.css 的 .reader-on */
        (readerOpen && doc ? ' reader-on' : '') +
        (barsHidden && canAutoHide ? ' bars-hidden' : '') +
        (barsPinned ? ' bars-pinned' : '')
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
      {/*
        阅读视图只有这一个入口。普通文档给 doc，超大文档给 outline ——
        两条数据来源、**同一个组件**，所以界面完全一致。
        （上一版给超大文档另写了个 LightReader，界面跟这儿对不上。）
      */}
      {longform && (
        <LongformEditor
          file={longform.id}
          title={longform.title}
          onExit={() => setLongform(null)}
        />
      )}

      {readerOpen && (doc || heavyOutline) && (
        <ReaderView
          docId={heavyOutline?.id ?? doc!.id}
          title={heavyOutline?.title ?? doc!.title}
          doc={heavyOutline ? undefined : doc!.content}
          outline={heavyOutline?.marks}
          comments={heavyOutline ? [] : comments}
          onSaveComment={saveComment}
          onRemoveComment={removeComment}
          onEditChapter={editChapterFromReader}
          onSwitchToEditor={heavyOutline ? () => void openInEditor(heavyOutline.id) : undefined}
          onClose={() => {
            setReaderOpen(false)
            setHeavyOutline(null)
          }}
        />
      )}
      <AiChatPanel
        open={chatOpen && Boolean(doc)}
        vaultMode={vaultMode}
        onOpenSource={(file, needle) =>
          /* 打开那篇，再用编辑器自己扫一遍这个短语落位 —— 不靠行号换算 */
          jumpToHit({ file, title: '', nth: 0, line: 0, snippet: '' }, needle)
        }
        title={doc?.title ?? ''}
        content={doc?.content ?? null}
        onClose={() => setChatOpen(false)}
        onInsert={insertToEnd}
      />
      <TitleBar
        asideShown={asideShown}
        onToggleAside={() => setAsideOpen((v) => !v)}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        vaultMode={vaultMode}
        vaultLabel={vaultLabel}
        view={view}
        onSwitchView={switchView}
        hasDoc={Boolean(doc)}
        onPin={pinToDesktop}
        moreItems={moreItems}
      />

      <div className="body">
        <Sidebar
          docs={docs}
          activeId={doc?.id ?? null}
          hidden={!sidebarShown}
          tags={allTags}
          activeTag={activeTag}
          stats={stats}
          goal={dailyGoal}
          onSelect={(id) => openInTab(id)}
          onCreate={(templateId) => void createNew(templateId)}
          onDelete={(id) => void removeDoc(id)}
          onStar={(id) => void toggleStar(id)}
          onTagFilter={setActiveTag}
          onOpenTrash={() => setTrashOpen(true)}
          onOpenLibrary={() => setLibraryOpen(true)}
        />

        <div className="main">
          {!libraryOpen && !settingsOpen && (
            <TabBar
              tabs={tabs}
              docs={docs}
              activeId={doc?.id ?? null}
              splitId={splitId}
              onSelect={openInTab}
              onClose={closeTab}
              onToggleSplit={() =>
                setSplitId((cur) => (cur ? null : (docRef.current?.id ?? null)))
              }
            />
          )}
          <div className={'main-split' + (splitId ? ' with-split' : '')}>
          {libraryOpen ? (
            <DocLibrary
              docs={docs}
              currentId={doc?.id ?? null}
              onOpen={(id) => {
                openInTab(id)
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
              {...settingsProps}
              onClose={() => setSettingsOpen(false)}
            />
          ) : !ready ? null : !doc ? (
            <div className="welcome">
              <h2>
                欢迎来到 <em>Quill</em>
              </h2>
              <p>左侧暂无文档。新建一篇后，输入 - 加空格即可开始列大纲，再点右上角查看思维导图。</p>
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
                  else toast.info('未找到该文档', title)
                }}
                onReady={handleEditorReady}
                onDropText={(fs) => void runImport(fs)}
                onDropPaths={(ps) => void importPaths(ps)}
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
          {splitId && (
            <SplitPane
              docs={docs}
              docId={splitId}
              onPick={(id) => setSplitId(id)}
              onClose={() => setSplitId(null)}
            />
          )}
          </div>
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

        {/*
          右侧栏：外观这类设置，调的时候不用离开正文。
          位置必须在这儿 —— `.body` 的**最后一个**子元素。
          插在 <Sidebar> 前面的话 flex 会按 DOM 顺序排，它就跑到最左边去了
          （实测踩过：宽度对、让位对、组件也对，就是「没在右边」）。
          收起走负 margin（真让位），这是本项目的规矩 ——
          用 transform 的话右边会留一条空白把正文挤扁。
        */}
        <aside className={'aside' + (asideShown ? '' : ' is-hidden')}>
          <SettingsView embedded {...settingsProps} onClose={closeAside} />
        </aside>
      </div>

      {conflict && (
        <ConflictDialog
          info={conflict}
          onKeepMine={() => void keepMine()}
          onTakeDisk={() => void takeDisk()}
          onMerge={() => void resolveMerge()}
          onAdoptRename={() => void adoptRename()}
          onSaveAsNew={() => void saveAsNew()}
          onRestoreHistory={() => {
            setHistoryOpen(true)
            toast.info('在历史里挑一版恢复', '恢复会把这一篇重新写回仓库')
          }}
          onLater={laterConflict}
        />
      )}

      <StatusBar
        saving={saving}
        hasConflict={Boolean(conflict)}
        /* 「稍后处理」收起之后，状态栏是唯一入口 */
        onOpenConflict={reopenConflict}
        progress={progress}
        doc={doc}
        docs={docs}
        onOpenDoc={(id) => void openDoc(id)}
        proseWidth={prose.width}
        onProseWidth={(width) => setProse((p) => ({ ...p, width }))}
      />
    </div>
  )
}
