import { useEffect, useMemo, useRef, useState } from 'react'
import { useSetting } from '../core/settings'
import { CARD_THEMES, renderExcerptCard } from '../core/excerptCard'
import { HI_COLORS, commentsToMarkdown, newCommentId, whenOf, type Comment, type HiColor } from '../core/comments'
import { toast } from './toast'
import { makeZip, safeName, type ZipFile } from '../core/zip'
import { filterByTag, parseTags, tagCounts, tagsText } from '../core/annotTags'
import ReviewCards from './ReviewCards'
import { dueList, readReview } from '../core/review'

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
  /** 复习进度按文档存；不传就没有复习入口 */
  docId?: string
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
  docId,
}: Props) {
  const [reviewing, setReviewing] = useState(false)
  // 到期数要读 localStorage + 解析，别每次渲染都算；复习结束（reviewing 变化）时重算
  const dueCount = useMemo(
    () => (docId ? dueList(comments, readReview(docId)).length : 0),
    [docId, comments, reviewing],
  )
  const [newText, setNewText] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editTags, setEditTags] = useState('')
  const [tagFilter, setTagFilter] = useState('all')
  const counts = useMemo(() => tagCounts(comments), [comments])
  // 筛选的标签被删光了就回到「全部」
  const activeFilter = tagFilter === 'all' || tagFilter === 'none' || counts.some((t) => t.tag === tagFilter) ? tagFilter : 'all'
  const shown = useMemo(() => filterByTag(comments, activeFilter), [comments, activeFilter])
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

  const submitNew = () => {
    const note = newText.trim()
    if (!note || !draft) return
    onSave({ id: newCommentId(), quote: draft, note, created: Date.now(), resolved: false, ...(color ? { color } : {}) })
    setNewText('')
    onDraftDone()
  }

  const submitEdit = (c: Comment) => {
    // 允许改成空：那就是一条纯高亮
    const tags = parseTags(editTags)
    const { tags: _old, ...rest } = c
    onSave({ ...rest, note: editText.trim(), ...(tags.length ? { tags } : {}) })
    setEditId(null)
  }

  const [cardTheme, setCardTheme] = useSetting('cardTheme', 'paper')
  const [packing, setPacking] = useState('')
  /** 把所有批注各画一张卡片，打成一个 zip；一张一张画，进度放在按钮上 */
  const savePack = async () => {
    if (packing || !comments.length) return
    try {
      const title = docTitle ?? '文档'
      const files: ZipFile[] = []
      for (let i = 0; i < comments.length; i += 1) {
        setPacking(`${i + 1}/${comments.length}`)
        const c = comments[i]
        const blob = await renderExcerptCard({
          quote: c.quote,
          note: c.note,
          title,
          accent: HI_COLORS.find((h) => h.id === c.color)?.hex,
          theme: cardTheme,
        })
        files.push({
          name: `${String(i + 1).padStart(3, '0')}-${safeName(c.quote.replace(/\s+/g, ''), 16)}.png`,
          data: new Uint8Array(await blob.arrayBuffer()),
        })
        // 让出主线程：几十张卡片连着画，界面不能僵住
        await new Promise((r) => setTimeout(r, 0))
      }
      const zip = makeZip(files)
      const url = URL.createObjectURL(new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `摘录卡片-${safeName(title, 30)}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 4000)
      toast.success('卡片包已生成', `共 ${files.length} 张`)
    } catch (e) {
      toast.error('生成失败', e instanceof Error ? e.message : '')
    } finally {
      setPacking('')
    }
  }

  const saveCard = async (c: Comment) => {
    try {
      const blob = await renderExcerptCard({
        quote: c.quote,
        note: c.note,
        title: docTitle ?? '文档',
        accent: HI_COLORS.find((h) => h.id === c.color)?.hex,
        theme: cardTheme,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `摘录-${(docTitle ?? '文档').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30)}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 2000)
      toast.success('卡片已生成', '已保存为 PNG 图片')
    } catch (e) {
      toast.error('生成失败', e instanceof Error ? e.message : '')
    }
  }

  if (!open) return null

  return (
    <aside className="drawer comments-pane">
      <div className="comments-head">
        <span>批注</span>
        <span className="comments-count">{comments.length}</span>
        <span className="grow" />
        <select
          className="comment-card-theme"
          value={cardTheme}
          onChange={(e) => setCardTheme(e.target.value)}
          title="摘录卡片的配色"
        >
          {CARD_THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              卡片·{t.name}
            </option>
          ))}
        </select>
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
        <button
          className="btn ghost mini"
          disabled={!comments.length || !!packing}
          title="每条批注画成一张图片卡片，打成一个 zip"
          onClick={() => void savePack()}
        >
          {packing ? `画卡片 ${packing}` : '卡片包'}
        </button>
        {docId && (
          <button
            className="btn ghost mini"
            disabled={!comments.length}
            title="把批注当闪卡复习"
            onClick={() => setReviewing(true)}
          >
            复习{comments.length ? ` ${dueCount}` : ''}
          </button>
        )}
        <button className="btn ghost icon" onClick={onClose} title="关闭">
          ×
        </button>
      </div>

      {reviewing && docId && (
        <ReviewCards
          cards={dueList(comments, readReview(docId)).map((c) => ({ docId, docTitle: docTitle ?? '', c }))}
          onClose={() => setReviewing(false)}
          onJump={(x) => onJump(x.c)}
        />
      )}

      {draft && !reviewing && (
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

      <div className="comments-body" hidden={reviewing}>
        {!comments.length && !draft && (
          <div className="comments-empty">
            暂无批注。
            <br />
            选中一段文字，点浮条上的「＋ 批注」。
          </div>
        )}

        {(counts.length > 0 || activeFilter !== 'all') && (
          <div className="comment-tagbar" role="tablist" aria-label="按标签筛选">
            {[
              { id: 'all', label: `全部 ${comments.length}` },
              ...counts.map((t) => ({ id: t.tag, label: `#${t.tag} ${t.n}` })),
              { id: 'none', label: '无标签' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeFilter === t.id}
                className={'comment-tagchip' + (activeFilter === t.id ? ' on' : '')}
                onClick={() => setTagFilter(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {shown.map((c) => (
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
                <input
                  className="comment-taginput"
                  value={editTags}
                  placeholder="标签：用逗号或空格分隔，如 金句 伏笔"
                  onChange={(e) => setEditTags(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
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
                {!!c.tags?.length && (
                  <div className="comment-tags">
                    {c.tags.map((t) => (
                      <button key={t} type="button" className="comment-tag" onClick={() => setTagFilter(t)}>
                        #{t}
                      </button>
                    ))}
                  </div>
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
                    title="存成一张摘录卡片图片"
                    onClick={() => void saveCard(c)}
                  >
                    卡片
                  </button>
                  <button
                    className="btn ghost mini"
                    onClick={() => {
                      setEditId(c.id)
                      setEditText(c.note)
                      setEditTags(tagsText(c.tags ?? []))
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
