import { useMemo, useRef, useState } from 'react'
import { ivlLabel, readReview, schedule, writeReview, type CardState, type Grade, type XCard } from '../core/review'
import type { Comment } from '../core/comments'

/**
 * 批注复习：一次一张。先只看引文，想一想，点「翻面」看自己当时写的批注，
 * 再自评记得 / 模糊 / 忘了。「忘了」的会在本轮结束前再出现一次。
 * 单本书的批注面板和「全部书一起复习」共用这一个组件，区别只在传进来的卡片队列。
 */
export default function ReviewCards({
  cards,
  onClose,
  onJump,
  showDoc,
  className,
}: {
  cards: XCard<Comment>[]
  onClose: () => void
  onJump: (card: XCard<Comment>) => void
  /** 全局复习时在卡片上标出出自哪本书 */
  showDoc?: boolean
  className?: string
}) {
  // 复习进度按文档存；每篇只读一次，之后在内存里改、同步写回
  const store = useRef<Record<string, Record<string, CardState>>>({})
  const statesOf = (docId: string) => (store.current[docId] ??= readReview(docId))

  const [queue, setQueue] = useState<XCard<Comment>[]>(cards)
  const [flip, setFlip] = useState(false)
  const [done, setDone] = useState(0)
  const total = useMemo(() => cards.length, [cards])
  const cur = queue[0]

  const answer = (g: Grade) => {
    if (!cur) return
    const st = statesOf(cur.docId)
    st[cur.c.id] = schedule(st[cur.c.id], g)
    writeReview(cur.docId, st)
    setQueue((q) => (g === 'again' ? [...q.slice(1), q[0]] : q.slice(1)))
    if (g !== 'again') setDone((d) => d + 1)
    setFlip(false)
  }

  const preview = (g: Grade) => (cur ? ivlLabel(schedule(statesOf(cur.docId)[cur.c.id], g)) : '')

  return (
    <div className={'review' + (className ? ` ${className}` : '')}>
      <div className="review-head">
        <span>复习批注</span>
        {total > 0 && (
          <span className="review-prog">
            {Math.min(done + 1, total)} / {total}
          </span>
        )}
        <span className="grow" />
        <button className="btn ghost mini" onClick={onClose}>
          结束
        </button>
      </div>
      {cur ? (
        <>
          {showDoc && <div className="review-doc">《{cur.docTitle || '未命名'}》</div>}
          <div className="review-card" onClick={() => setFlip(true)}>
            <div className="review-quote">{cur.c.quote}</div>
            {flip ? (
              <div className="review-note">{cur.c.note || '（当时只做了高亮，没写批注）'}</div>
            ) : (
              <div className="review-hint">想想当时为什么划这句 · 点击翻面</div>
            )}
          </div>
          <div className="review-actions">
            {flip ? (
              <>
                <button className="btn ghost" onClick={() => answer('again')} title={preview('again')}>
                  忘了
                </button>
                <button className="btn ghost" onClick={() => answer('hazy')} title={preview('hazy')}>
                  模糊
                </button>
                <button className="btn primary" onClick={() => answer('good')} title={preview('good')}>
                  记得
                </button>
              </>
            ) : (
              <button className="btn primary" onClick={() => setFlip(true)}>
                翻面
              </button>
            )}
            <button className="btn ghost mini" onClick={() => onJump(cur)}>
              定位原文
            </button>
          </div>
        </>
      ) : (
        <div className="review-empty">
          {total ? `这一轮 ${total} 张都过完啦，辛苦～` : '今天没有要复习的，先去读读书吧。'}
        </div>
      )}
    </div>
  )
}
