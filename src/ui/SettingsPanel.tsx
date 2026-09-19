import { useCallback, useEffect, useState } from 'react'
import { storage, type RemoteInfo } from '../core/storage'
import { toast } from './toast'

interface Props {
  open: boolean
  onClose: () => void
}

export default function SettingsPanel({ open, onClose }: Props) {
  const [url, setUrl] = useState('')
  const [ca, setCa] = useState('')
  const [token, setToken] = useState('')
  const [info, setInfo] = useState<RemoteInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')

  const reload = useCallback(async () => {
    if (!storage.remoteInfo) return
    try {
      const i = await storage.remoteInfo()
      setInfo(i)
      setUrl(i.url ?? '')
      setCa(i.sslCa ?? '')
    } catch (err) {
      setLog(String(err))
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setLog('')
    setToken('')
    void reload()
  }, [open, reload])

  if (!open) return null

  const save = async () => {
    if (!storage.saveGitSettings) return
    setBusy(true)
    try {
      await storage.saveGitSettings(url.trim(), ca.trim(), token)
      toast.success('备份设置已保存', url.trim() ? '远程地址已更新' : '已清除远程地址')
      setToken('')
      await reload()
    } catch (err) {
      toast.error('保存失败', String(err))
      setLog(String(err))
    } finally {
      setBusy(false)
    }
  }

  const push = async () => {
    if (!storage.pushNow) return
    setBusy(true)
    setLog('正在推送…')
    try {
      const out = await storage.pushNow()
      setLog(out || '推送完成')
      toast.success('已备份到远程')
      await reload()
    } catch (err) {
      setLog(String(err))
      toast.error('推送失败', String(err).slice(0, 120))
    } finally {
      setBusy(false)
    }
  }

  const hasRemote = Boolean(info?.url)

  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div
        className="modal"
        style={{ width: 'min(600px, 92vw)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span>备份与设置</span>
          <button className="btn ghost icon" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="sc-group">
            <div className="sc-title">远程备份</div>
            <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.8, marginBottom: 12 }}>
              把文档仓库推到一个私有仓库（GitHub / Gitea / 自建都行）。
              换机器、硬盘坏掉都能拿回来——**文档是纯 Markdown，任何 git 客户端都能读**。
            </p>

            <label className="field">
              <span>远程地址</span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/你的用户名/quill-notes.git"
                spellCheck={false}
              />
            </label>

            <label className="field">
              <span>访问令牌（可选）</span>
              <input
                value={token}
                type="password"
                onChange={(e) => setToken(e.target.value)}
                placeholder={info?.hasToken ? '已保存（留空则不改动）' : 'ghp_… / github_pat_…'}
                spellCheck={false}
              />
            </label>

            <label className="field">
              <span>CA 证书包（可选）</span>
              <input
                value={ca}
                onChange={(e) => setCa(e.target.value)}
                placeholder="被代理/自签证书拦截时才需要，填合并后的 crt 路径"
                spellCheck={false}
              />
            </label>

            <div className="field-row">
              <button className="btn primary" onClick={() => void save()} disabled={busy}>
                保存设置
              </button>
              <button className="btn" onClick={() => void push()} disabled={busy || !hasRemote}>
                {busy ? '处理中…' : '立即备份'}
              </button>
              <span className="grow" />
              <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                {info?.ahead == null
                  ? hasRemote
                    ? '未获取过上游状态'
                    : '尚未配置'
                  : info.ahead > 0
                    ? `有 ${info.ahead} 个提交待推送`
                    : '本地已与远程同步'}
              </span>
            </div>

            {log && <pre className="preview" style={{ maxHeight: 160, marginTop: 12 }}>{log}</pre>}
          </div>

          <div className="sc-group">
            <div className="sc-title">存储位置</div>
            <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.8 }}>
              文档以纯 <code>.md</code> 文件存放在 <code>{storage.label}</code>，每次保存自动产生一次 git 提交。
            </p>
            <div className="field-row">
              <button className="btn" onClick={() => void storage.reveal()}>
                在资源管理器中打开
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
