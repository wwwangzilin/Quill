import { useCallback, useEffect, useState } from 'react'
import { storage, type TrashItem } from '../core/storage'
import { formatWhen } from '../core/time'
import { toast } from './toast'

interface Props {
  open: boolean
  onClose: () => void
  onChanged: () => void
}

export default function TrashPanel({ open, onClose, onChanged }: Props) {
  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(false)
  const [confirm, setConfirm] = useState<'none' | 'empty' | string>('none')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await storage.trash())
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setConfirm('none')
      void load()
    }
  }, [open, load])

  if (!open) return null

  const restore = async (item: TrashItem) => {
    try {
      await storage.restoreTrash(item.name)
      toast.success('已恢复', item.original)
      await load()
      onChanged()
    } catch (err) {
      toast.error('恢复失败', String(err))
    }
  }

  const purge = async (item: TrashItem) => {
    try {
      await storage.purgeTrash(item.name)
      toast.info('已彻底删除', item.original)
      setConfirm('none')
      await load()
    } catch (err) {
      toast.error('删除失败', String(err))
    }
  }

  const emptyAll = async () => {
    try {
      await storage.emptyTrash()
      toast.info('回收站已清空')
      setConfirm('none')
      await load()
    } catch (err) {
      toast.error('清空失败', String(err))
    }
  }

  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className="modal" style={{ width: 'min(520px, 92vw)' }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>
            回收站 {items.length > 0 && <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>· {items.length} 项</span>}
          </span>
          <button className="btn ghost icon" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        <div className="modal-body" style={{ minHeight: 120 }}>
          {loading && <div className="empty-hint">读取中…</div>}
          {!loading && !items.length && (
            <div className="empty-hint">
              回收站是空的。
              <br />
              删除的文档会先落到这里，而不是直接消失。
            </div>
          )}

          {items.map((item) => (
            <div className="trash-item" key={item.name}>
              <span className="t" title={item.original}>
                {item.original.replace(/\.md$/, '')}
              </span>
              <span className="when">{formatWhen(item.deleted)}</span>
              <button className="btn" onClick={() => void restore(item)}>
                恢复
              </button>
              {confirm === item.name ? (
                <button className="btn" style={{ color: 'var(--accent-3)' }} onClick={() => void purge(item)}>
                  确认删除?
                </button>
              ) : (
                <button className="btn ghost icon" title="彻底删除" onClick={() => setConfirm(item.name)}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        {items.length > 0 && (
          <div className="modal-head" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-3)', fontWeight: 400 }}>
              彻底删除后只能靠 git 历史找回
            </span>
            {confirm === 'empty' ? (
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="btn" style={{ color: 'var(--accent-3)' }} onClick={() => void emptyAll()}>
                  确认清空
                </button>
                <button className="btn ghost" onClick={() => setConfirm('none')}>
                  取消
                </button>
              </span>
            ) : (
              <button className="btn ghost" onClick={() => setConfirm('empty')}>
                清空回收站
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
