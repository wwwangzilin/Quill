import { useEffect, useState } from 'react'
import { storage } from '../core/storage'
import { dueAcross, readReview, type XCard } from '../core/review'
import type { Comment } from '../core/comments'
import type { DocMeta } from '../core/types'
import ReviewCards from './ReviewCards'

/**
 * 全部书一起复习：把每本书里到期的批注合成一个队列，每天打开一次就够了。
 * 只在桌面版有批注可读（storage.comments）；读完所有文档的批注才开始，不会读一半就出题。
 */
export default function GlobalReview({
  open,
  docs,
  onClose,
  onOpenDoc,
}: {
  open: boolean
  docs: DocMeta[]
  onClose: () => void
  onOpenDoc: (id: string) => void
}) {
  const [cards, setCards] = useState<XCard<Comment>[] | null>(null)

  useEffect(() => {
    if (!open) {
      setCards(null)
      return
    }
    let alive = true
    void (async () => {
      const loaded: { docId: string; docTitle: string; comments: Comment[] }[] = []
      for (const d of docs) {
        try {
          const comments = (await storage.comments?.(d.id)) ?? []
          if (comments.length) loaded.push({ docId: d.id, docTitle: d.title, comments })
        } catch {
          /* 某一篇读不出批注就跳过它，不拦其他的 */
        }
      }
      if (alive) setCards(dueAcross(loaded, readReview))
    })()
    return () => {
      alive = false
    }
  }, [open, docs])

  if (!open) return null
  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal global-review" role="dialog" aria-label="批注复习">
        {cards === null ? (
          <div className="review-empty">正在收集各本书的批注…</div>
        ) : (
          <ReviewCards
            cards={cards}
            showDoc
            onClose={onClose}
            onJump={(x) => {
              onClose()
              onOpenDoc(x.docId)
            }}
          />
        )}
      </div>
    </div>
  )
}
