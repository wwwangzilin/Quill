import { useEffect, useRef, useState } from 'react'
import { HI_COLORS, commentsToMarkdown, newCommentId, whenOf, type Comment, type HiColor } from '../core/comments'
import { toast } from './toast'

interface Props {
  open: boolean
  onClose: () => void
  comments: Comment[]
  /** 从正文选中带进来的新建草稿（引文已经填好） */
  draft: string | null
  onDraftDone: () => void
  onSave: (c: Comment) => void
  onDelete: (id: string) => void
  onJump: (c: Comment) => void
  /** 从正文点底纹进来时要高亮的那条 */
  focusId: string | null
  /** 新建批注用的荧光笔颜色（阅读视图选的；编辑器里不传就是旧样式） */
  color?: HiColor
  /** 导出文件名里用的文档标题 */
  docTitle?: string
}

/**
 * 批注面板。
 *
 * 所有批注交互都收在这里：新建（从正文选中带引文过来）、就地编辑、删除、跳回正文。
 * 这样正文里就只剩「底纹高亮」一件事，不用再叠一层浮层。
 */
export default function CommentsPanel({
  open,
  onClose,
  comments,
  draft,
  onDraftDone,
  onSave,
  onDelete,
  onJump,
  focusId,
  color,
  docTitle,
}: Props) {
  const [newText, setNewText] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const newRef = useRef<HTMLTextAreaElement>(null)

  // 带着草稿进来 → 清空输入并聚焦
  useEffect(() => {
    if (!open || !draft) return
    setNewText('')
    const t = window.setTimeout(() => newRef.current?.focus(), 60)
    return () => window.clearTimeout(t)
  }, [open, draft])

  // 从正文点进来 → 滚到那一条
  useEffect(() => {
    if (!open || !focusId) return
    const t = window.setTimeout(() => {
      document
        .querySelector(`.comment-item[data-id="${focusId}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 90)
    return () => window.clearTimeout(t)
  }, [open, focusId, comments.length])

  if (!open) return null

  const submitNew = () => {
    const note = newText.trim()
    if (!note || !draft) return
    onSave({ id: newCommentId(), quote: draft, note, created: Date.now(), resolved: false, ...(color ? { color } : {}) })
    setNewText('')
    onDraftDone()
  }

  const submitEdit = (c: Comment) => {
    // 允许改成空：那就是一条纯高亮
    onSave({ ...c, note: editText.trim() })
    setEditId(null)
  }

  return (
    <aside className="drawer comments-pane">
      <div className="comments-head">
        <span>批注</span>
        <span className="comments-count">{comments.length}</span>
        <span className="grow" />
        <button
          className="btn ghost mini"
          disabled={!comments.length}
          title="把所有批注和高亮复制成 Markdown"
          onClick={() => {
            void navigator.clipboard
              .writeText(commentsToMarkdown(docTitle ?? '文档', comments))
              .then(
                () => toast.success('已复制批注', `共 ${comments.length} 条，粘贴到任何地方都是 Markdown`),
                () => toast.error('复制失败', '浏览器不允许访问剪贴板'),
              )
          }}
        >
          导出
        </button>
        <button className="btn ghost icon" onClick={onClose} title="关闭">
          ×
        </button>
      </div>

      {draft && (
        <div className="comment-new">
          <div className="comment-quote" title={draft}>
            {draft}
          </div>
          <textarea
            ref={newRef}
            className="comment-input"
            placeholder="写下批注内容 · Ctrl+Enter 保存，Esc 取消"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                submitNew()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                onDraftDone()
              }
            }}
          />
          <div className="comment-actions">
            <button className="btn primary" disabled={!newText.trim()} onClick={submitNew}>
              保存
            </button>
            <button className="btn ghost" onClick={onDraftDone}>
              取消
            </button>
          </div>
        </div>
      )}

      <div className="comments-body">
        {!comments.length && !draft && (
          <div className="comments-empty">
            暂无批注。
            <br />
            选中一段文字，点浮条上的「＋ 批注」。
          </div>
        )}

        {comments.map((c) => (
          <div
            key={c.id}
            data-id={c.id}
            className={'comment-item' + (c.id === focusId ? ' on' : '')}
          >
            <div className="comment-quote" title={c.quote} onClick={() => onJump(c)}>
              {c.quote.length > 100 ? `${c.quote.slice(0, 100)}…` : c.quote}
            </div>

            {editId === c.id ? (
              <>
                <textarea
                  className="comment-input"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault()
                      submitEdit(c)
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setEditId(null)
                    }
                  }}
                />
                <div className="comment-actions">
                  <button className="btn primary" onClick={() => submitEdit(c)}>
                    保存
                  </button>
                  <button className="btn ghost" onClick={() => setEditId(null)}>
                    取消
                  </button>
                </div>
              </>
            ) : (
              <>
                {c.note ? (
                  <div className="comment-note">{c.note}</div>
                ) : (
                  <div className="comment-note comment-note-empty">仅高亮</div>
                )}
                <div className="comment-foot">
                  <span className="comment-dots" role="radiogroup" aria-label="荧光笔颜色">
                    {HI_COLORS.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        role="radio"
                        aria-checked={c.color === h.id}
                        className={'hi-dot' + (c.color === h.id ? ' on' : '')}
                        style={{ background: h.hex }}
                        title={h.name}
                        onClick={() => onSave({ ...c, color: h.id })}
                      />
                    ))}
                  </span>
                  <span className="comment-when">{whenOf(c.created)}</span>
                  <span className="grow" />
                  <button className="btn ghost mini" onClick={() => onJump(c)}>
                    定位
                  </button>
                  <button
                    className="btn ghost mini"
                    onClick={() => {
                      setEditId(c.id)
                      setEditText(c.note)
                    }}
                  >
                    改
                  </button>
                  <button className="btn ghost mini" onClick={() => onDelete(c.id)}>
                    删
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}
