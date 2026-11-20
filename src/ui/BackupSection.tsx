import { useCallback, useEffect, useState } from 'react'
import { toast } from './toast'
import { Icon } from './Icon'
import { isDesktop } from '../core/desktop'
import {
  backupDocs,
  backupList,
  backupNow,
  backupRestoreAll,
  backupRestoreDoc,
  backupReveal,
  backupSavePrefs,
  backupStatus,
  sizeText,
  whenText,
  type BackupInfo,
  type BackupPrefs,
  type BackupStatus,
} from '../core/backup'

/**
 * 设置 → 自动备份。
 *
 * 这一页要回答三件事：**备到哪、上一次成没成、怎么拿回来**。
 * 所以顶上永远是「上次备份时间 + 结果」，失败原因直接摊开写，
 * 而不是等用户下次发现没备份时再猜。
 */
export default function BackupSection() {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [list, setList] = useState<BackupInfo[]>([])
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null)
  /** 正在确认恢复的那一份 */
  const [confirming, setConfirming] = useState<{ name: string; doc: boolean } | null>(null)
  /** 恢复单篇时，这一份备份里有哪些文档 */
  const [docs, setDocs] = useState<string[]>([])
  const [docPick, setDocPick] = useState('')
  const [dirDraft, setDirDraft] = useState('')
  const [error, setError] = useState('')
  const desktop = isDesktop()

  const refresh = useCallback(async () => {
    if (!desktop) return
    try {
      const st = await backupStatus()
      setStatus(st)
      setDirDraft(st.prefs.dir)
      setList(await backupList())
    } catch (err) {
      setError(String(err))
    }
  }, [desktop])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const savePrefs = useCallback(
    async (patch: Partial<BackupPrefs>) => {
      const cur = status?.prefs
      if (!cur) return
      try {
        const next = await backupSavePrefs({ ...cur, ...patch })
        setStatus(next)
        setError('')
      } catch (err) {
        setError(String(err).slice(0, 200))
      }
    },
    [status],
  )

  const runBackup = useCallback(async () => {
    setBusy('backup')
    setError('')
    try {
      const info = await backupNow()
      toast.success('已备份', `${info.name} · ${sizeText(info.size)}`)
      await refresh()
    } catch (err) {
      const msg = String(err).slice(0, 200)
      setError(msg)
      toast.error('备份失败', msg)
      await refresh()
    } finally {
      setBusy(null)
    }
  }, [refresh])

  const startRestore = useCallback(
    async (item: BackupInfo, doc: boolean) => {
      setConfirming({ name: item.name, doc })
      setDocs([])
      setDocPick('')
      if (doc) {
        try {
          const files = await backupDocs(item.name)
          setDocs(files)
          setDocPick(files[0] ?? '')
        } catch (err) {
          setError(String(err).slice(0, 200))
        }
      }
    },
    [],
  )

  const doRestore = useCallback(async () => {
    if (!confirming) return
    setBusy('restore')
    setError('')
    try {
      if (confirming.doc) {
        if (!docPick) throw new Error('先选一篇')
        await backupRestoreDoc(confirming.name, docPick)
        toast.success('已恢复这一篇', '原来的版本留成了 .md.bak')
      } else {
        const report = await backupRestoreAll(confirming.name)
        toast.success(
          '整库已恢复',
          report.snapshot
            ? `恢复前已自动备份 ${report.snapshot}；旧仓库留在 ${report.displaced}`
            : `旧仓库留在 ${report.displaced}`,
        )
      }
      setConfirming(null)
      // 仓库整个换过（或单篇被覆盖），重新加载一次最省事也最稳
      window.setTimeout(() => window.location.reload(), 800)
    } catch (err) {
      const msg = String(err).slice(0, 240)
      setError(msg)
      toast.error('恢复失败', msg)
    } finally {
      setBusy(null)
    }
  }, [confirming, docPick])

  if (!desktop) {
    return <p className="hint">备份在浏览器调试模式下不可用：它要读写真实目录。</p>
  }

  const p = status?.prefs

  return (
    <>
      <label className="sc-row">
        <div>
          <div className="sc-title">自动备份</div>
          <div className="sc-text">按间隔把整个仓库（含 .git）打成一个 zip，留着最坏情况下用</div>
        </div>
        <input
          type="checkbox"
          checked={Boolean(p?.enabled)}
          onChange={(e) => void savePrefs({ enabled: e.target.checked })}
        />
      </label>

      <label className="sc-row">
        <div>
          <div className="sc-title">备份间隔</div>
          <div className="sc-text">应用开着的时候才会跑；关掉之后下次打开会补一次</div>
        </div>
        <select
          className="sc-select"
          value={p?.intervalHours ?? 24}
          onChange={(e) => void savePrefs({ intervalHours: Number(e.target.value) })}
        >
          <option value={24}>每天一次</option>
          <option value={72}>每三天一次</option>
          <option value={168}>每周一次</option>
        </select>
      </label>

      <label className="sc-row">
        <div>
          <div className="sc-title">保留份数</div>
          <div className="sc-text">超出的自动删最旧的</div>
        </div>
        <input
          className="sc-num"
          type="number"
          min={1}
          max={365}
          value={p?.keep ?? 7}
          onChange={(e) => void savePrefs({ keep: Number(e.target.value) })}
        />
      </label>

      <div className="sc-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sc-title">备份位置</div>
          <div className="sc-text">留空 = 文档目录下的 Quill Backups</div>
          <input
            className="sc-input"
            value={dirDraft}
            placeholder="默认：文档 / Quill Backups"
            onChange={(e) => setDirDraft(e.target.value)}
            onBlur={() => {
              if (dirDraft !== (p?.dir ?? '')) void savePrefs({ dir: dirDraft.trim() })
            }}
          />
        </div>
        <button className="btn" onClick={() => void backupReveal()} title="在资源管理器里打开">
          <Icon name="folder" /> 打开
        </button>
      </div>

      {status && !status.writable && (
        <p className="hint" style={{ color: 'var(--accent-3)' }}>
          ⚠ 这个目录现在写不了：{status.dirError ?? '未知原因'}
        </p>
      )}

      <div className="sc-row">
        <div>
          <div className="sc-title">立即备份</div>
          <div className="sc-text">
            {p?.lastAt
              ? `上次：${whenText(p.lastAt)} · ${p.lastOk ? `成功 ${sizeText(p.lastSize)}` : '失败'}`
              : '还没备份过'}
          </div>
          {p?.lastError && !p.lastOk && (
            <div className="sc-text" style={{ color: 'var(--accent-3)' }}>
              失败原因：{p.lastError}
            </div>
          )}
        </div>
        <button className="btn primary" disabled={busy !== null} onClick={() => void runBackup()}>
          {busy === 'backup' ? '备份中…' : '备份一次'}
        </button>
      </div>

      {error && (
        <p className="hint" style={{ color: 'var(--accent-3)' }}>
          {error}
        </p>
      )}

      <p className="hint">
        现有 {status?.count ?? 0} 份，共 {sizeText(status?.totalBytes ?? 0)} · 目录：
        {status?.dir ?? ''}
      </p>

      <div className="bk-list">
        {list.map((item) => (
          <div className="bk-item" key={item.name}>
            <div className="bk-main">
              <div className="bk-name">{item.name}</div>
              <div className="bk-meta">
                {whenText(item.created)} · {sizeText(item.size)}
              </div>
            </div>
            {confirming?.name === item.name ? (
              <div className="bk-confirm">
                {confirming.doc && (
                  <select
                    className="sc-select"
                    value={docPick}
                    onChange={(e) => setDocPick(e.target.value)}
                  >
                    {docs.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                )}
                <button className="btn primary" disabled={busy !== null} onClick={() => void doRestore()}>
                  {busy === 'restore' ? '恢复中…' : confirming.doc ? '覆盖这一篇' : '确认整库恢复'}
                </button>
                <button className="btn ghost" onClick={() => setConfirming(null)}>
                  取消
                </button>
              </div>
            ) : (
              <div className="bk-acts">
                <button className="btn" onClick={() => void startRestore(item, false)}>
                  恢复整库
                </button>
                <button className="btn ghost" onClick={() => void startRestore(item, true)}>
                  恢复单篇
                </button>
              </div>
            )}
          </div>
        ))}
        {list.length === 0 && <p className="hint">还没有备份。点上面的「备份一次」先存一份。</p>}
      </div>

      <p className="hint">
        恢复整库会先把当前状态自动备份一份，再把旧仓库改名留在旁边（不删）。恢复单篇会把原来的那一篇存成
        .md.bak。
      </p>
    </>
  )
}
