import { useCallback, useEffect, useState, type RefObject } from 'react'
import type { Editor } from '@tiptap/core'
import { toast } from '../ui/toast'
import { locate, type Comment } from '../core/comments'
import { applyComments, onCommentPick } from '../editor/commentMark'
import { storage } from '../core/storage'
import type { Doc } from '../core/types'

/**
 * 当前文档的批注：读取、落盘、增删、跳转。
 *
 * 批注存 .quill-meta.json，不进 .md；落盘一律「先读磁盘再合并」，见 persistComments。
 */
export function useComments(opts: {
  docRef: RefObject<Doc | null>
  editorRef: RefObject<Editor | null>
  /** 当前文档 id；换文档时据此重读批注 */
  docId: string | undefined
  /** 编辑器重建键；重建后要把底纹重新灌进去 */
  sessionKey: number
}) {
  const { docRef, editorRef, docId, sessionKey } = opts

  /** 当前文档的批注（存 .quill-meta.json，不进 .md） */
  const [comments, setComments] = useState<Comment[]>([])
  const [commentsOpen, setCommentsOpen] = useState(false)
  /** 从正文选中带进面板的新建草稿（引文） */
  const [commentDraft, setCommentDraft] = useState<string | null>(null)
  /** 从正文点底纹进来时要高亮的那条 */
  const [commentFocus, setCommentFocus] = useState<string | null>(null)

  // 换文档时读一次批注
  useEffect(() => {
    const id = docId
    /*
     * 先清空。切文档的窗口期里，界面上不该还挂着上一篇的批注；
     * 更要紧的是别让这期间的写操作拿到上一篇的列表。
     */
    setComments([])
    if (!id || !storage.comments) return
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
  }, [docId])

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

  /**
   * 批注落盘：**先读磁盘，再以磁盘为准合并**。
   *
   * 绝对不能拿内存里的列表整个覆盖。切文档那一小会儿，内存里可能还挂着
   * 上一篇的批注、或者新文档的列表压根没读完 —— 一覆盖就把盘上的抹掉了。
   * 实装机上真的丢过主人的两条批注，就是这么没的。
   * 写完顺手把内存也刷成磁盘的结果，界面不至于停在残缺的那一份上。
   */
  const persistComments = useCallback(
    async (fileId: string, mutate: (list: Comment[]) => Comment[]) => {
      if (!storage.comments || !storage.setComments) return
      const onDisk = await storage.comments(fileId).catch(() => [] as Comment[])
      const next = mutate(onDisk)
      await storage.setComments(fileId, next)
      if (docRef.current?.id === fileId) setComments(next)
    },
    [],
  )

  /* ---------------- 批注操作 ---------------- */

  const saveComment = useCallback(
    (next: Comment) => {
      const id = docRef.current?.id
      if (!id) return
      // 界面先跟上（乐观更新），磁盘那份交给 persistComments 以磁盘为准去合并
      setComments((prev) => {
        const exists = prev.some((c) => c.id === next.id)
        return exists ? prev.map((c) => (c.id === next.id ? next : c)) : [...prev, next]
      })
      void persistComments(id, (list) => {
        const exists = list.some((c) => c.id === next.id)
        return exists ? list.map((c) => (c.id === next.id ? next : c)) : [...list, next]
      }).catch((err) => toast.error('批注保存失败', String(err).slice(0, 120)))
    },
    [persistComments],
  )

  const removeComment = useCallback(
    (cid: string) => {
      const id = docRef.current?.id
      if (!id) return
      setComments((prev) => prev.filter((c) => c.id !== cid))
      void persistComments(id, (list) => list.filter((c) => c.id !== cid)).catch((err) =>
        toast.error('批注删除失败', String(err).slice(0, 120)),
      )
    },
    [persistComments],
  )

  /** 跳回批注锚定的那段文字；正文改过就按引文重新找 */
  const jumpToComment = useCallback((c: Comment) => {
    const ed = editorRef.current
    if (!ed || ed.isDestroyed) return
    const at = locate(ed.state.doc, c.quote)
    if (!at) {
      toast.info('正文已改动', '该批注暂时无法定位')
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

  return {
    comments,
    commentsOpen,
    setCommentsOpen,
    commentDraft,
    setCommentDraft,
    commentFocus,
    setCommentFocus,
    saveComment,
    removeComment,
    jumpToComment,
  }
}
