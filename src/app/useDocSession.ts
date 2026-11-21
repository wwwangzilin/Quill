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
import {
  SaveConflictError,
  asSaveConflict,
  type ConflictInfo,
  type DiskMark,
} from '../core/docGuard'

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
  /** 进长文本模式（按章节窗口化加载，可编辑） */
  openLongform: (file: string, title: string) => void
}

/**
 * 文档会话：文档列表、当前文档、保存（防抖落盘）、打开 / 新建 / 删除 / 星标 / 标签，
 * 以及一切会改动「当前文档」的操作。
 *
 * 这里是写作数据流的唯一入口 —— 想知道「内容是怎么存下去的」，只看这一个文件。
 */
export function useDocSession(ui: SessionUi) {
  const { setView, heavyOutline, setHeavyOutline, setReaderOpen, openLongform } = ui

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
  /** 磁盘上这一篇的摘要（我最后见到的那一版）—— 保存时的 baseDigest 就从这儿来 */
  const diskMarkRef = useRef<DiskMark | null>(null)
  /** 有没有还没落盘的改动：窗口重新聚焦时据此决定「静默跟上」还是「弹冲突」 */
  const dirtyRef = useRef(false)
  /** 冲突的即时版本（persist / scheduleSave 是稳定回调，闭包里读 state 会读到旧值） */
  const conflictRef = useRef<ConflictInfo | null>(null)
  /**
   * 外部改动冲突。非空时整篇写入一律挡住 —— 保存被拒不是错误，是「先看一眼」。
   */
  const [conflict, setConflict] = useState<ConflictInfo | null>(null)

  /* ---------------- 持久化 ---------------- */

  /**
   * 记下磁盘此刻的摘要。
   *
   * 浏览器调试模式没有文件，`stamp` 不存在 —— 那就清空，让 `put` 退化成
   * 「不校验、直接写」的老行为，别把浏览器模拟也拖进冲突流程。
   */
  const syncDiskMark = useCallback(async (id: string) => {
    if (!storage.stamp) {
      diskMarkRef.current = null
      return
    }
    try {
      const st = await storage.stamp(id)
      diskMarkRef.current = st.exists ? { digest: st.digest, size: st.size } : null
    } catch {
      diskMarkRef.current = null
    }
  }, [])

  /** 挂上/撤掉冲突：一挂上就停掉待跑的保存，界面切到「有冲突」 */
  const showConflict = useCallback((info: ConflictInfo | null) => {
    conflictRef.current = info
    setConflict(info)
    if (!info) return
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setSaving('conflict')
  }, [])

  /**
   * 把一次「保存被拒」变成弹给用户看的对比单。
   *
   * 外部改名要靠「摘要 + 大小」认回同一篇：认回来了就提示「跟随改名」，
   * 认不回来才当删除处理 —— 别一上来就让用户以为文件没了。
   */
  const raiseConflict = useCallback(
    async (
      base: Doc,
      live: { title: string; content: JSONContent },
      err: SaveConflictError,
    ) => {
      let renamedTo: string | null = null
      const mark = diskMarkRef.current
      if (err.code === 'deleted' && mark && storage.findByDigest) {
        renamedTo = await storage.findByDigest(mark.digest, mark.size).catch(() => null)
      }
      let disk = err.disk
      // 浏览器的 Err / 老版本 Rust 不带 disk 时，自己把磁盘那份读回来做对比
      if (err.code === 'conflict' && disk == null && storage.raw) {
        disk = await storage.raw(base.id).catch(() => null)
      }
      showConflict({
        code: err.code,
        docId: base.id,
        title: live.title,
        mine: docToMarkdown(live.content, live.title),
        disk,
        renamedTo,
        at: Date.now(),
      })
      dirtyRef.current = true
    },
    [showConflict],
  )

  /**
   * 落盘。
   *
   * `force` 是「不管磁盘上是什么，按我的写」—— 只有用户已经在冲突框里
   * 明确选过「保存我的版本 / 接到文末」才配用。平时一律带上 baseDigest：
   * 磁盘被外部改过就一个字都不写，把两份都摆到用户面前。
   */
  const persist = useCallback(
    async (force = false): Promise<boolean> => {
      const base = docRef.current
      const live = liveRef.current
      /*
       * 「没有当前文档」不是保存失败，是**没什么可存**。
       * 这个分支以前返回 false，于是启动时那次 canLeave() 被当成存不下，
       * 直接把「自动打开第一篇」拦了下来（表现出来就是：有文档、却没有标签）。
       */
      if (!base || !live) return true
      // 冲突没解决之前不写 —— 否则「暂停自动保存」只是一句空话
      if (!force && conflictRef.current) return false
      const candidate: Doc = {
        ...base,
        title: live.title,
        content: live.content,
        updatedAt: Date.now(),
      }
      try {
        const res = await storage.put(candidate, {
          baseDigest: force ? null : diskMarkRef.current?.digest,
        })
        if (res.digest != null) {
          diskMarkRef.current = { digest: res.digest, size: res.size ?? 0 }
        }
        const next = { ...candidate, id: res.id }
        docRef.current = next
        dirtyRef.current = false
        const meta = toMeta(next)
        setDocs((prev) =>
          sortDocs([meta, ...prev.filter((m) => m.id !== meta.id && m.id !== base.id)]),
        )
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
        return true
      } catch (err) {
        const clash = asSaveConflict(err)
        if (clash) {
          await raiseConflict(base, live, clash)
          return false
        }
        console.error('保存失败', err)
        toast.error('保存失败', String(err))
        setSaving('idle')
        return false
      }
    },
    [raiseConflict],
  )

  const scheduleSave = useCallback(() => {
    // 冲突期间照旧记「有改动」，但不再排保存 —— 每次打字都弹一次框会很烦
    if (conflictRef.current) return
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

  /**
   * 立刻落盘，并把结果交出去。
   *
   * 以前它只返回 void，「存失败了没有」只能靠内部状态猜 —— 切文档时就没法拦。
   * 现在返回布尔：调用方（切文档 / 关标签）必须先拿到 true 才允许走。
   */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    return await persist()
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

      // 启动时也走同一个打开入口：大文档在这里同样要进长文本模式，
      // 否则「自动判定」只在手动切文档时生效，一重启就漏了
      if (list[0] && !cancelled) void openDoc(list[0].id)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
    // openDoc 定义在本函数后面，但 effect 是渲染之后才执行，引用是安全的
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // 先把这一篇存好，下面序列化的才是刚存下去的内容；存不下就别合并
        if (!(await flush())) {
          toast.error('合并失败', '这一篇还没能存下来，先处理保存问题')
          return
        }
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
    // 进门先记住磁盘这一版是什么样：之后每次保存都拿它当 baseDigest 去核对
    await syncDiskMark(id)
    dirtyRef.current = false
    showConflict(null)
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
  }, [mergeBack, showConflict, syncDiskMark])

  /* ---------------- 外部改动的处理 ---------------- */

  /** 以我的版本为准写回去（用户拍板了，才走这条强制覆盖） */
  const keepMine = useCallback(async () => {
    const ok = await persist(true)
    if (!ok) return
    showConflict(null)
    toast.success('已按你的版本保存', '磁盘上被覆盖的那一版仍能在历史抽屉里找回')
  }, [persist, showConflict])

  /** 丢掉我的未保存改动，改用磁盘上的版本 */
  const takeDisk = useCallback(async () => {
    const cur = docRef.current
    if (!cur) return
    showConflict(null)
    dirtyRef.current = false
    await openInEditor(cur.id)
    toast.info('已采用磁盘上的版本', '未保存的改动已丢弃')
  }, [openInEditor, showConflict])

  /** 外部改名：换成新文件名接着写 */
  const adoptRename = useCallback(async () => {
    const info = conflictRef.current
    const base = docRef.current
    const live = liveRef.current
    if (!info?.renamedTo || !base || !live) return
    try {
      const st = storage.stamp ? await storage.stamp(info.renamedTo) : null
      if (st && !st.exists) {
        toast.error('那个文件又不见了', info.renamedTo)
        return
      }
      const res = await storage.put(
        { ...base, id: info.renamedTo, title: live.title, content: live.content, updatedAt: Date.now() },
        { baseDigest: st?.digest },
      )
      if (res.digest != null) diskMarkRef.current = { digest: res.digest, size: res.size ?? 0 }
      const next: Doc = {
        ...base,
        id: res.id,
        title: live.title,
        content: live.content,
        updatedAt: Date.now(),
      }
      docRef.current = next
      setDoc(next)
      setDocs((prev) => sortDocs([toMeta(next), ...prev.filter((m) => m.id !== base.id)]))
      showConflict(null)
      dirtyRef.current = false
      setSaving('saved')
      toast.success('已跟随改名', `现在写的是 ${res.id}`)
    } catch (err) {
      const clash = asSaveConflict(err)
      if (clash) await raiseConflict({ ...base, id: info.renamedTo }, live, clash)
      else toast.error('跟随改名失败', String(err).slice(0, 120))
    }
  }, [raiseConflict, showConflict])

  /** 另存为一篇新文档：原路径没了也不丢字 */
  const saveAsNew = useCallback(async () => {
    const base = docRef.current
    const live = liveRef.current
    if (!live) return
    try {
      const fresh = await storage.create(live.title || base?.title || '未命名')
      const body: Doc = { ...fresh, title: live.title || fresh.title, content: live.content }
      const res = await storage.put(body)
      const next: Doc = { ...body, id: res.id }
      docRef.current = next
      liveRef.current = { title: next.title, content: next.content }
      lastCharsRef.current = countChars(next.content)
      if (res.digest != null) diskMarkRef.current = { digest: res.digest, size: res.size ?? 0 }
      setDoc(next)
      setDocs((prev) => sortDocs([toMeta(next), ...prev.filter((m) => m.id !== base?.id)]))
      setSessionKey((k) => k + 1)
      showConflict(null)
      dirtyRef.current = false
      setSaving('saved')
      toast.success('已另存为新文档', res.id)
    } catch (err) {
      toast.error('另存失败', String(err).slice(0, 160))
    }
  }, [showConflict])

  /** 先放着：关掉弹窗，但保存继续暂停（状态栏上有入口能再打开） */
  const laterConflict = useCallback(() => {
    setConflict(null)
  }, [])

  /**
   * 能不能离开当前这一篇（切文档、关标签之前必须问一次）。
   *
   * 为什么要有它：`flush()` 失败时以前是「记一笔 + toast 一下」就继续往下走，
   * 切走的那一刻，编辑器里没落盘的内容就没了 —— 磁盘满、文件被占用、
   * 目录只读，都会走到这条路上。现在离开前必须拿到明确的 true。
   *
   * 失败时不静默：给三个出口（重试保存 / 另存为 / 取消），并且**默认不离开**。
   */
  const canLeave = useCallback(async (): Promise<boolean> => {
    // 冲突没解决：先把对比框叫回来，等用户拍板
    if (conflictRef.current) {
      setConflict(conflictRef.current)
      toast.error('这篇还有未保存的冲突', '先处理完再离开')
      return false
    }
    const ok = await flush()
    if (ok) return true
    toast.ask('无法保存当前文档', '内容还留在编辑器里；换一篇或关掉标签就会丢', [
      { label: '重试保存', primary: true, run: () => void flush() },
      { label: '另存为', run: () => void saveAsNew() },
      { label: '取消', run: () => {} },
    ])
    return false
  }, [flush, saveAsNew])

  /*
   * 窗口重新聚焦时对一眼磁盘。
   *
   * 为什么先做「聚焦时检查」而不是实时监听：实时监听要引 notify / fsevents，
   * 三平台的坑比收益大；而一个人改完外部文件，回到 Quill 的第一件事就是点窗口，
   * 这一刻足以覆盖绝大多数场景。
   */
  useEffect(() => {
    if (!vaultMode || !storage.stamp) return
    let busy = false
    const check = async () => {
      const cur = docRef.current
      if (busy || !cur || conflictRef.current) return
      busy = true
      try {
        const st = await storage.stamp!(cur.id)
        const mark = diskMarkRef.current
        if (!st.exists) {
          // 没有基线 = 这篇本来就没落过盘（新建还没保存），不算被删
          const live = liveRef.current
          if (!mark || !live) return
          await raiseConflict(cur, live, new SaveConflictError('deleted'))
          return
        }
        if (mark && st.digest === mark.digest) return
        if (!dirtyRef.current) {
          // 我一个字没改：直接跟上磁盘，别拿过期版本去覆盖人家
          diskMarkRef.current = { digest: st.digest, size: st.size }
          const fresh = await storage.get(cur.id)
          if (!fresh) return
          docRef.current = fresh
          liveRef.current = { title: fresh.title, content: fresh.content }
          lastCharsRef.current = countChars(fresh.content)
          setDoc(fresh)
          setSessionKey((k) => k + 1)
          toast.info('这篇在外部被改过', '已载入磁盘上的新版本')
          return
        }
        const live = liveRef.current
        if (!live) return
        const disk = storage.raw ? await storage.raw(cur.id).catch(() => null) : null
        showConflict({
          code: 'conflict',
          docId: cur.id,
          title: live.title,
          mine: docToMarkdown(live.content, live.title),
          disk,
          renamedTo: null,
          at: Date.now(),
        })
      } finally {
        busy = false
      }
    }
    const onFocus = () => void check()
    const onVisible = () => {
      if (!document.hidden) void check()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [vaultMode, raiseConflict, showConflict])

  const openDoc = useCallback(
    async (id: string) => {
      // 存不下就不切：宁可这一下没反应，也不能把没落盘的内容带走
      if (docRef.current?.id !== id && !(await canLeave())) return

      /*
       * 先问 Rust 要一份「章节目录 + 文件大小」，**不搬正文**。
       * 700 万字的原文有 21MB，IPC 转一趟（还得 JSON 转义）纯属浪费 ——
       * 判断大小用不上它，切章也已经挪到 Rust 侧了。
       */
      const o = storage.outline ? await storage.outline(id).catch(() => null) : null
      if (o && o.bytes > HEAVY_BYTES) {
        const head = storage.readSlice ? await storage.readSlice(id, 0, 600).catch(() => '') : ''
        // 标题优先取清单里的（文件名去掉 .md），其次才看正文开头有没有 # 标题
        const listed = docs.find((d) => d.id === id)?.title
        const heavyTitle = listed || splitTitle(head).title || id.replace(/\.md$/, '')
        /*
         * 大文档**直接进长文本模式**，不再问「看还是改」。
         *
         * 那个二选一本身就是旧结构留下的问题：能看的不能改，能改的会卡。
         * 现在长文本模式自己就能改 —— 一次只挂三章，编辑成本和文档总长无关。
         * 判定放在这里（拿到索引之后、进编辑器之前），不存在「先全量加载再降级」。
         */
        openLongform(id, heavyTitle)
        return
      }
      await openInEditor(id)
    },
    [canLeave, openInEditor],
  )

  const createNew = useCallback(
    async (templateId = 'blank') => {
      if (!(await canLeave())) return
      const tpl = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0]
      const fresh = await storage.create(tpl.id === 'blank' ? '未命名' : tpl.name)
      const withBody = { ...fresh, content: tpl.build() }
      await storage.put(withBody)
      void syncDiskMark(withBody.id)
      dirtyRef.current = false
      showConflict(null)
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
    [canLeave, showConflict, syncDiskMark],
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
        if (!(await canLeave())) return
        const fresh = await storage.create(title)
        const withBody = { ...fresh, content: parseDocument(markdown).doc }
        await storage.put(withBody)
        void syncDiskMark(withBody.id)
        dirtyRef.current = false
        showConflict(null)
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
    [canLeave, heavyOutline, showConflict, syncDiskMark],
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
      if (!(await canLeave())) return
      const tpl = TEMPLATES.find((t) => t.id === 'daily') ?? TEMPLATES[0]
      const fresh = await storage.create(key)
      const withBody = { ...fresh, content: tpl.build() }
      await storage.put(withBody)
      void syncDiskMark(withBody.id)
      dirtyRef.current = false
      showConflict(null)
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
  }, [canLeave, openDoc, showConflict, syncDiskMark])

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
      dirtyRef.current = true
      setDoc((d) => (d ? { ...d, title } : d))
      scheduleSave()
    },
    [scheduleSave],
  )

  const onChange = useCallback(
    (content: JSONContent) => {
      if (!liveRef.current) return
      liveRef.current.content = content
      dirtyRef.current = true
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
    canLeave,
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
    /* 外部改动冲突：App 负责画对比框，这里给状态和几个出口 */
    conflict,
    keepMine,
    takeDisk,
    adoptRename,
    saveAsNew,
    laterConflict,
    /** 状态栏那条「处理冲突」入口：把「稍后处理」收起来的框叫回来 */
    reopenConflict: () => setConflict(conflictRef.current),
    clearConflict: () => showConflict(null),
    forcePersist: () => persist(true),
  }
}
