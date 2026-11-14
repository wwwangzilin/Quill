import { useCallback, useRef, useState, type RefObject } from 'react'
import type { Editor } from '@tiptap/core'
import type { DocSearchHit } from '../core/searchDocs'
import type { Doc } from '../core/types'
import { jumpToNth } from './docUtils'

/**
 * 编辑器实例的「桥」：拿到实例、等它就绪后兑现待办的跳转、全文搜索结果的跳转。
 */
export function useEditorBridge(opts: {
  docRef: RefObject<Doc | null>
  openDoc: (id: string) => Promise<void>
}) {
  const { docRef, openDoc } = opts

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

  return { editorRef, liveEditor, handleEditorReady, jumpToHit }
}
