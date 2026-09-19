import { useCallback, useEffect, useRef, useState } from 'react'
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
import SettingsPanel from './ui/SettingsPanel'
import QuickCapture from './ui/QuickCapture'
import { TEMPLATES } from './core/templates'
import { openQuickNote, openSticky } from './core/windows'
import { initStorage, storage } from './core/storage'
import { docToMarkdown, safeFileName } from './core/markdown'
import type { Doc, DocMeta, ViewMode } from './core/types'
import { WELCOME } from './core/welcome'
import { setAssetResolver } from './core/asset'

type Saving = 'idle' | 'saving' | 'saved'

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
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('quill-theme') === 'light' ? 'light' : 'dark',
  )
  const [saving, setSaving] = useState<Saving>('idle')
  const [ready, setReady] = useState(false)
  const [mapSnap, setMapSnap] = useState<{ content: JSONContent; title: string } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
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
  const [quickOpen, setQuickOpen] = useState(false)
  /** 编辑器实例的重建键：只在新开文档时递增，改名导致的 id 变化不重建（否则光标会飞） */
  const [sessionKey, setSessionKey] = useState(0)

  const docRef = useRef<Doc | null>(null)
  const liveRef = useRef<{ title: string; content: JSONContent } | null>(null)
  const timerRef = useRef<number | null>(null)
  const lastCharsRef = useRef(0)

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
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void persist()
    }, 650)
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

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('quill-theme', theme)
  }, [theme])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void flush()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flush])

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
      if (key === '\\') {
        e.preventDefault()
        setSidebarOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [createNew])

  const removeDoc = useCallback(
    async (id: string) => {
      const target = docs.find((d) => d.id === id)
      await storage.remove(id)
      toast.success('已删除', target?.title ?? id)
      const rest = docs.filter((d) => d.id !== id)
      setDocs(rest)
      if (docRef.current?.id === id) {
        if (rest.length) {
          await openDoc(rest[0].id)
        } else {
          docRef.current = null
          liveRef.current = null
          setDoc(null)
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
    setExportOpen(false)
  }, [])

  const exportJson = useCallback(() => {
    const live = liveRef.current
    if (!live || !docRef.current) return
    const payload = { ...docRef.current, title: live.title, content: live.content }
    download(`${safeFileName(live.title)}.json`, JSON.stringify(payload, null, 2), 'application/json')
    setExportOpen(false)
  }, [])

  /* ---------------- 渲染 ---------------- */

  return (
    <div className="app">
      <ToastHost />
      <ShortcutsPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <TrashPanel
        open={trashOpen}
        onClose={() => setTrashOpen(false)}
        onChanged={() => void refreshDocs()}
      />
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <QuickCapture
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        onSubmit={(text) => void quickCapture(text)}
      />
      <div className="titlebar">
        <button
          className="btn ghost icon"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? '收起侧栏' : '展开侧栏'}
        >
          ☰
        </button>
        <div className="brand">
          <span className="mark" />
          Quill
        </div>
        {vaultMode && (
          <button
            className="btn ghost icon"
            title={`文档仓库：${vaultLabel}（点击打开文件夹）`}
            onClick={() => void storage.reveal()}
          >
            🗀
          </button>
        )}
        <div className="grow" />
        <div className="seg">
          <button className={view === 'write' ? 'on' : ''} onClick={() => switchView('write')}>
            写作
          </button>
          <button className={view === 'mindmap' ? 'on' : ''} onClick={() => switchView('mindmap')}>
            导图
          </button>
        </div>
        {vaultMode && (
          <button
            className={'btn ghost icon' + (historyOpen ? ' on' : '')}
            onClick={() => setHistoryOpen((v) => !v)}
            title="版本历史（git）"
            disabled={!doc}
          >
            ⏱
          </button>
        )}
        <div style={{ position: 'relative' }}>
          <button
            className="btn ghost icon"
            onClick={() => setExportOpen((v) => !v)}
            title="导出"
            disabled={!doc}
          >
            ⇩
          </button>
          {exportOpen && (
            <div className="menu">
              <button onClick={exportMd}>导出 Markdown（.md）</button>
              <button onClick={exportJson}>导出 JSON（.json）</button>
            </div>
          )}
        </div>
        <button
          className="btn ghost icon"
          onClick={() => void openQuickNote()}
          title="快捷便签（Ctrl+Space）"
        >
          ✎
        </button>
        <button
          className="btn ghost icon"
          onClick={() => void pinToDesktop()}
          title="钉到桌面（磁贴）"
          disabled={!doc}
        >
          📌
        </button>
        <button
          className="btn ghost icon"
          onClick={() => setSettingsOpen(true)}
          title="备份与设置"
        >
          ⚙
        </button>
        <button
          className="btn ghost icon"
          onClick={() => setShortcutsOpen(true)}
          title="快捷键（Ctrl+/）"
        >
          ?
        </button>
        <button
          className={'btn ghost icon' + (focusMode ? ' on' : '')}
          onClick={() => {
            const next = !focusMode
            setFocusMode(next)
            toast.info(next ? '专注模式已开：只亮当前段落' : '专注模式已关')
          }}
          title="专注模式"
          disabled={view !== 'write'}
        >
          ◉
        </button>
        <button
          className={'btn ghost icon' + (typewriter ? ' on' : '')}
          onClick={() => {
            const next = !typewriter
            setTypewriter(next)
            toast.info(next ? '打字机模式已开：光标锁定视口' : '打字机模式已关')
          }}
          title="打字机模式"
          disabled={view !== 'write'}
        >
          ⇅
        </button>
        <button
          className="btn ghost icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title="切换主题"
        >
          {theme === 'dark' ? '☾' : '☀'}
        </button>
      </div>

      <div className="body">
        <Sidebar
          docs={docs}
          activeId={doc?.id ?? null}
          hidden={!sidebarOpen}
          tags={allTags}
          activeTag={activeTag}
          stats={stats}
          onSelect={(id) => void openDoc(id)}
          onCreate={(templateId) => void createNew(templateId)}
          onDelete={(id) => void removeDoc(id)}
          onStar={(id) => void toggleStar(id)}
          onTagFilter={setActiveTag}
          onOpenTrash={() => setTrashOpen(true)}
        />

        <div className="main">
          {!ready ? null : !doc ? (
            <div className="welcome">
              <h2>
                欢迎来到 <em>Quill</em>
              </h2>
              <p>左边还没有文档。新建一篇，用 - 加空格开始列大纲，再点右上角看看导图。</p>
              <button className="btn primary" onClick={() => void createNew()}>
                ＋ 新建文档
              </button>
            </div>
          ) : view === 'write' ? (
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
              onOpenDoc={(title) => {
                const target = docs.find((d) => d.title === title)
                if (target) void openDoc(target.id)
                else toast.info('还没有这篇文档', title)
              }}
            />
          ) : (
            <div className="pane">
              <MindMap
                content={mapSnap?.content}
                title={mapSnap?.title ?? ''}
                onJump={(path) => {
                  setJumpPath(path)
                  setView('write')
                }}
              />
            </div>
          )}
        </div>

        {historyOpen && doc && (
          <HistoryDrawer
            file={doc.id}
            onClose={() => setHistoryOpen(false)}
            onRestored={() => void openDoc(doc.id)}
          />
        )}
      </div>
    </div>
  )
}
