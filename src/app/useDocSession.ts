import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { toast } from '../ui/toast'
import { TEMPLATES } from '../core/templates'
import { openSticky } from '../core/windows'
import { initStorage, storage } from '../core/storage'
import { splitTitle, parseDocument } from '../core/md-parse'
import { docToMarkdown } from '../core/markdown'
import { clearOrigin, fnv1a32, readOrigin, writeOrigin } from '../core/chapterOrigin'
import type { Doc, DocMeta, ViewMode } from '../core/types'
import { WELCOME } from '../core/welcome'
import { setAssetResolver } from '../core/asset'
import type { Saving, HeavyOutline } from './types'
import { toMeta, sortDocs, countChars, todayKey } from './docUtils'

/**
 * 超过这个体积就不进编辑器了。
 *
 * 按**字节**算：40 万汉字 ≈ 120 万字节。这个量级大概一万三千个顶层块，
 * 已经在卡的边缘；几百万字的那些（主人库里有 700 万字的小说）是二十多万个块，
 * ProseMirror 必死 —— 不是加个 CSS 能救的。到了这个量级就改走轻量阅读：
 * 只读、按章现解析。
 */
const HEAVY_BYTES = 1_200_000

/** 会话要反过来改的几处界面状态，由 App 传进来 */
export interface SessionUi {
  setView: (v: ViewMode) => void
  heavyOutline: HeavyOutline | null
  setHeavyOutline: (v: HeavyOutline | null) => void
  setReaderOpen: (v: boolean) => void
}

/**
 * 文档会话：文档列表、当前文档、保存（防抖落盘）、打开 / 新建 / 删除 / 星标 / 标签，
 * 以及一切会改动「当前文档」的操作。
 *
 * 这里是写作数据流的唯一入口 —— 想知道「内容是怎么存下去的」，只看这一个文件。
 */
export function useDocSession(ui: SessionUi) {
  const { setView, heavyOutline, setHeavyOutline, setReaderOpen } = ui

  const [docs, setDocs] = useState<DocMeta[]>([])
  const [doc, setDoc] = useState<Doc | null>(null)
  const [saving, setSaving] = useState<Saving>('idle')
  const [ready, setReady] = useState(false)
  const [vaultMode, setVaultMode] = useState(false)
  const [vaultLabel, setVaultLabel] = useState('')
  const [allTags, setAllTags] = useState<string[]>([])
  const [stats, setStats] = useState<Record<string, number>>({})
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

  /**
   * 把「摘出来改」的那一章并回原书。
   *
   * 覆盖前先核对：Rust 侧拿 `[from, to)` 的实际长度和摘走时比，对不上就拒绝 ——
   * 免得在一本已经变过的书上按老坐标覆盖，把别处的改动一起抹掉。
   */
  const mergeBack = useCallback(
    async (id: string) => {
      const o = readOrigin(id)
      const me = docRef.current
      if (!o) return
      if (!me || me.id !== id) {
        toast.error('合并失败', '请先打开该文档再合并')
        return
      }
      try {
        await flush() // 先把这一篇存好，下面序列化的才是刚存下去的内容
        if (!storage.writeSlice) throw new Error('这个版本不支持合并')
        /*
         * **不传 title**：docToMarkdown 一旦拿到标题就会在最前面塞一行 `# 书名`，
         * 并回原书就变成章节里凭空多出个大标题。
         */
        const md = docToMarkdown(me.content)
        const size = await storage.writeSlice(o.srcId, o.from, o.to, md, o.digest)
        clearOrigin(id)
        toast.success('已合并回原书', `《${o.srcTitle}》${o.chapterTitle} · 全书现在 ${size} 字节`)
      } catch (err) {
        toast.error('合并失败', String(err).slice(0, 160))
      }
    },
    [flush],
  )

  /**
   * 真的把正文搬进编辑器。
   *
   * 超大文档走这条路会卡（二十多万个块），但**功能是齐的** ——
   * 标签、批注、导图、AI、导出全在。要功能就得认这份卡，所以由主人自己选。
   */
  const openInEditor = useCallback(async (id: string) => {
    const next = await storage.get(id)
    if (!next) return
    docRef.current = next
    liveRef.current = { title: next.title, content: next.content }
    lastCharsRef.current = countChars(next.content)
    setDoc(next)
    setSessionKey((k) => k + 1)
    setSaving('idle')
    setView('write')
    setHeavyOutline(null)
    setReaderOpen(false)
    /*
     * 这一篇要是「摘出来改」出来的，就告诉主人它的来路，顺手留一个合并入口。
     * 放在打开**之后**问：人还没改呢，一进门就问「要不要合并」没道理。
     */
    const origin = readOrigin(id)
    if (origin) {
      toast.ask(
        `这篇是从《${origin.srcTitle}》摘出来的`,
        `${origin.chapterTitle} · 改完可合并回原书，也可作为独立文档保留`,
        [
          { label: '合并回原书', primary: true, run: () => void mergeBack(id) },
          { label: '先不改', run: () => {} },
        ],
      )
    }
  }, [mergeBack])

  const openDoc = useCallback(
    async (id: string) => {
      await flush()

      /*
       * 先问 Rust 要一份「章节目录 + 文件大小」，**不搬正文**。
       * 700 万字的原文有 21MB，IPC 转一趟（还得 JSON 转义）纯属浪费 ——
       * 判断大小用不上它，切章也已经挪到 Rust 侧了。
       */
      const o = storage.outline ? await storage.outline(id).catch(() => null) : null
      if (o && o.bytes > HEAVY_BYTES) {
        const head = storage.readSlice ? await storage.readSlice(id, 0, 600).catch(() => '') : ''
        const heavyTitle = splitTitle(head).title || '未命名'
        const wan = Math.round(o.bytes / 3 / 10000)
        /*
         * 超大文档**不替主人做决定**。
         *
         * 上一版我直接把人塞进分栏阅读，理由是编辑器会卡。理由没错，**结论错了** ——
         * 主人一句「那些 tag 什么的功能全都用不了」就把问题戳穿了：能看不等于能用。
         * 所以两条路都摆出来，各自的代价写清楚，让他自己挑。
         */
        toast.ask(
          `这篇约 ${wan} 万字，选择编辑还是阅读？`,
          '进编辑器：标签 / 导图 / AI 均可用，但大文档会卡　·　分栏阅读：流畅，但仅可阅读',
          [
            { label: '进编辑器', primary: true, run: () => void openInEditor(id) },
            {
              label: '分栏阅读',
              run: () => {
                setHeavyOutline({ id, title: heavyTitle, marks: o.marks })
                setReaderOpen(true)
                toast.info(`分栏阅读 · 约 ${wan} 万字`, '按章加载 · 可随时切回编辑器')
              },
            },
          ],
        )
        return
      }
      await openInEditor(id)
    },
    [flush, openInEditor],
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

  /**
   * 阅读视图里「摘出来改」：把超大文档的某一章复制成一篇普通文档。
   *
   * 为什么不直接编辑原文件：那篇 709 万字的进不了 ProseMirror，
   * 硬塞进去、保存时没加载的那部分会被当成删除（真丢字，不是卡一下）。
   * 所以走「摘一章出来改」，原书保持只读、一个字不动。
   */
  const editChapterFromReader = useCallback(
    async (title: string, markdown: string, range: { from: number; to: number }) => {
      try {
        await flush()
        const fresh = await storage.create(title)
        const withBody = { ...fresh, content: parseDocument(markdown).doc }
        await storage.put(withBody)
        /*
         * 记下这一篇的来路，改完才能并回去。
         * 只有区间成立时才记 —— 坏坐标比没有坐标危险得多。
         */
        writeOrigin(withBody.id, {
          srcId: heavyOutline?.id ?? '',
          srcTitle: heavyOutline?.title ?? '',
          from: range.from,
          to: range.to,
          // 摘走时那一段的摘要 —— 合并前拿它认「还是不是原来那一章」
          digest: fnv1a32(markdown),
          chapterTitle: title.split(' · ').slice(1).join(' · ') || title,
          at: Date.now(),
        })
        docRef.current = withBody
        liveRef.current = { title: withBody.title, content: withBody.content }
        lastCharsRef.current = countChars(withBody.content)
        setDoc(withBody)
        setDocs((prev) => sortDocs([toMeta(withBody), ...prev]))
        setSessionKey((k) => k + 1)
        setReaderOpen(false)
        setHeavyOutline(null)
        setView('write')
        setSaving('idle')
        toast.success('已摘出本章', '改完可合并回原书 · 原书未作改动')
      } catch (err) {
        toast.error('摘出失败', String(err).slice(0, 120))
      }
    },
    [flush, heavyOutline],
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

  /** 把当前文档固定为桌面磁贴 */
  const pinToDesktop = useCallback(async () => {
    const d = docRef.current
    if (!d) return
    try {
      await openSticky(d.id, d.title)
      toast.success('已固定到桌面', d.title)
    } catch (err) {
      toast.error('固定失败', String(err))
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
        toast.success('已记入收件箱')
        await refreshDocs()
      } catch (err) {
        toast.error('保存失败', String(err))
      }
    },
    [refreshDocs],
  )

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
      toast.success('已插入文末')
    },
    [onChange],
  )

  return {
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
  }
}
