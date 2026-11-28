import { useEffect, useMemo, useRef, useState } from 'react'
import { storage } from '../core/storage'
import { readBookmarks } from '../core/bookmarks'
import { readReview } from '../core/review'
import { bookMarkdown, exportFiles, searchAnnots, splitByQuery, type AEntry } from '../core/annotCenter'
import { makeZip } from '../core/zip'
import type { DocMeta } from '../core/types'
import { toast } from './toast'

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function Marked({ text, q }: { text: string; q: string }) {
  return (
    <>
      {splitByQuery(text, q).map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>))}
    </>
  )
}

/**
 * 批注与书签中心：跨所有书检索自己写过的批注、划过的句子、打过的书签，
 * 也可以把每本书的批注（含复习状态）导出成 Markdown，扔进 Obsidian 之类的笔记软件。
 */
export default function AnnotCenter({
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
  const [entries, setEntries] = useState<AEntry[] | null>(null)
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setEntries(null)
      return
    }
    let alive = true
    void (async () => {
      const list: AEntry[] = []
      for (const d of docs) {
        let comments: AEntry['comments'] = []
        try {
          comments = (await storage.comments?.(d.id)) ?? []
        } catch {
          /* 这一本读不出就跳过 */
        }
        const bookmarks = readBookmarks(d.id)
        if (comments.length || bookmarks.length) list.push({ docId: d.id, docTitle: d.title, comments, bookmarks })
      }
      if (alive) setEntries(list)
    })()
    const t = window.setTimeout(() => inputRef.current?.focus(), 60)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [open, docs])

  const query = q.trim()
  const result = useMemo(() => searchAnnots(entries ?? [], query), [entries, query])
  if (!open) return null

  const totalC = (entries ?? []).reduce((n, e) => n + e.comments.length, 0)
  const totalB = (entries ?? []).reduce((n, e) => n + e.bookmarks.length, 0)

  const exportAll = () => {
    const files = exportFiles(entries ?? [], readReview)
    if (!files.length) return void toast.info('没有可导出的批注或书签')
    const zip = makeZip(files)
    save(new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' }), '批注与书签.zip')
    toast.success('已导出', `共 ${files.length} 本书，每本一个 Markdown`)
  }
  const exportOne = (e: AEntry) => {
    save(new Blob([bookMarkdown(e, readReview(e.docId))], { type: 'text/markdown' }), `${e.docTitle || '未命名'}-批注.md`)
  }

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal annot-center"
        role="dialog"
        aria-label="批注与书签"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="annot-head">
          <input
            ref={inputRef}
            value={q}
            placeholder="搜所有书里的批注、划线和书签…"
            onChange={(e) => setQ(e.target.value)}
            spellCheck={false}
          />
          <button className="btn ghost mini" onClick={exportAll} disabled={!entries?.length} title="每本书一个 Markdown，打成 zip">
            导出全部
          </button>
          <button className="btn ghost mini" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="annot-body">
          {entries === null && <div className="annot-tip">正在收集各本书的批注…</div>}
          {entries && !query && (
            <div className="annot-tip">
              {entries.length
                ? `共 ${entries.length} 本书 · ${totalC} 条批注 · ${totalB} 个书签。输入关键词开始搜。`
                : '还没有任何批注或书签。在阅读视图里选中文字加批注、点书签图标就会出现在这里。'}
            </div>
          )}
          {entries && query && !result.total && <div className="annot-tip">没找到「{query}」。</div>}
          {result.groups.map((g) => {
            const entry = entries?.find((e) => e.docId === g.docId)
            return (
              <div key={g.docId} className="annot-group">
                <div className="annot-doc">
                  <button
                    className="annot-doc-name"
                    onClick={() => {
                      onClose()
                      onOpenDoc(g.docId)
                    }}
                    title="打开这本书"
                  >
                    《{g.docTitle || '未命名'}》<em>{g.hits.length}</em>
                  </button>
                  {entry && (
                    <button className="btn ghost mini" onClick={() => exportOne(entry)}>
                      导出本书
                    </button>
                  )}
                </div>
                {g.hits.map((h) =>
                  h.kind === 'comment' ? (
                    <div key={h.id} className="annot-hit">
                      <div className="annot-quote">
                        <Marked text={h.quote} q={query} />
                      </div>
                      {h.note && (
                        <div className="annot-note">
                          <Marked text={h.note} q={query} />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div key={h.id} className="annot-hit annot-bm">
                      <span aria-hidden="true">🔖</span> <Marked text={h.label} q={query} />
                    </div>
                  ),
                )}
              </div>
            )
          })}
          {result.truncated && <div className="annot-tip">只显示前 200 条，换个更具体的词。</div>}
        </div>
      </div>
    </div>
  )
}
