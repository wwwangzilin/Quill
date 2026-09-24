import { useCallback, useEffect, useState } from 'react'
import { storage, type CommitInfo } from '../core/storage'
import { formatWhen } from '../core/time'
import { toast } from './toast'

interface Props {
  file: string
  onClose: () => void
  onRestored: () => void
}

export default function HistoryDrawer({ file, onClose, onRestored }: Props) {
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<CommitInfo | null>(null)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setCommits(await storage.history(120))
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openCommit = useCallback(
    async (commit: CommitInfo) => {
      setActive(commit)
      setConfirming(false)
      setPreview('')
      try {
        setPreview(await storage.fileAt(commit.hash, file))
      } catch {
        setPreview('')
      }
    },
    [file],
  )

  const doRestore = useCallback(async () => {
    if (!active) return
    setBusy(true)
    try {
      await storage.restore(active.hash, file)
      await load()
      toast.success('已回滚', `${file} → ${active.short}`)
      setActive(null)
      setConfirming(false)
      onRestored()
    } catch (err) {
      setError(String(err))
      toast.error('回滚失败', String(err))
    } finally {
      setBusy(false)
    }
  }, [active, file, load, onRestored])

  return (
    <aside className="drawer">
      <div className="drawer-head">
        <div style={{ minWidth: 0 }}>
          <div className="drawer-title">版本历史</div>
          <div className="drawer-sub" title={file}>
            {file}
          </div>
        </div>
        <button className="btn ghost icon" onClick={onClose} title="关闭">
          ×
        </button>
      </div>

      <div className="drawer-list">
        {loading && <div className="empty-hint">读取 git 历史…</div>}
        {!loading && error && <div className="empty-hint" style={{ color: 'var(--accent-3)' }}>{error}</div>}
        {!loading && !error && !commits.length && (
          <div className="empty-hint">
            还没有提交记录。
            <br />
            每次保存都会自动 commit 一次。
          </div>
        )}
        {commits.map((c) => {
          const mine = c.files.includes(file)
          return (
            <button
              key={c.hash}
              className={
                'commit' + (active?.hash === c.hash ? ' on' : '') + (mine ? ' mine' : '')
              }
              onClick={() => void openCommit(c)}
            >
              <div className="row">
                <span className="hash">{c.short}</span>
                <span className="when">{formatWhen(c.time * 1000)}</span>
              </div>
              <div className="msg">{c.message}</div>
              {c.files.length > 0 && (
                <div className="files">
                  {c.files.slice(0, 3).join(' · ')}
                  {c.files.length > 3 ? ` +${c.files.length - 3}` : ''}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {active && (
        <div className="drawer-detail">
          <div className="detail-head">
            <span>
              {active.short} 时的内容
            </span>
            {confirming ? (
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="btn" disabled={busy} onClick={() => void doRestore()}>
                  {busy ? '恢复中…' : '确定恢复'}
                </button>
                <button className="btn ghost" onClick={() => setConfirming(false)}>
                  取消
                </button>
              </span>
            ) : (
              <button className="btn" onClick={() => setConfirming(true)} disabled={!preview}>
                恢复此版本
              </button>
            )}
          </div>
          <pre className="preview">{preview || '该版本里还没有这个文件'}</pre>
        </div>
      )}
    </aside>
  )
}
