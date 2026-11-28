import { useState } from 'react'
import { toast } from './toast'
import { isDesktop } from '../core/desktop'
import { readCfg, readLast, readPreBackup, runSync, saveCfg, savePreBackup, summarize, testConnection, type DavCfg } from '../core/webdavSync'
import { whenText } from '../core/backup'

/**
 * 设置 → WebDAV 同步。
 * 说清楚三件事：同步什么（根目录的 .md）、不同步什么（删除 / 图片 / 标签批注）、冲突怎么办。
 */
export default function WebdavSection() {
  const [cfg, setCfg] = useState<DavCfg>(readCfg)
  const [busy, setBusy] = useState<'test' | 'sync' | null>(null)
  const [preBackup, setPreBackup] = useState(readPreBackup)
  const [step, setStep] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string; lines?: string[] } | null>(null)
  const [last, setLast] = useState(readLast)
  const desktop = isDesktop()
  const set = (patch: Partial<DavCfg>) => {
    const next = { ...cfg, ...patch }
    setCfg(next)
    saveCfg(next)
  }

  const test = async () => {
    setBusy('test')
    setMsg(null)
    try {
      setMsg({ ok: true, text: await testConnection(cfg) })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }
  const sync = async () => {
    setBusy('sync')
    setMsg(null)
    try {
      const r = await runSync(cfg, setStep)
      const lines = [
        ...r.conflicts.map((n) => `冲突：${n}（远端版本已覆盖，你本机那份另存为「冲突」副本）`),
        ...r.errors.map((x) => `失败：${x.name} —— ${x.msg}`),
      ]
      setMsg({ ok: r.errors.length === 0, text: summarize(r), lines })
      setLast(readLast())
      if (r.errors.length === 0) toast.success('同步完成', summarize(r))
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
      setStep('')
    }
  }

  return (
    <>
      <p className="desc">
        把文档仓库根目录下的 <code>.md</code> 文档与 WebDAV 目录互相同步（坚果云、Nextcloud、群晖等都行）。
        两边都改过同一篇时，以远端为准，你本机那份会另存为「（冲突 日期）」副本，不会丢。
      </p>
      <p className="desc">
        另外会同步<b>阅读进度和书签</b>（每本书取最近读的那一份，换设备接着读；「第几屏」会因屏幕大小有几屏偏差，但章是对的）、<b>标签、星标、批注</b>（两边取并集）和 <code>assets/</code> 里的<b>图片</b>（按文件名补齐，超过 25MB 的跳过）。
        <b>不同步删除</b>：文档、标签、批注、图片在任何一边删了，下次都会从另一边补回来。
        需要完整备份请用「远程备份」或「自动备份」。
      </p>
      {!desktop && <p className="desc">WebDAV 同步只在桌面版可用。</p>}

      <label className="field">
        <span>WebDAV 目录地址</span>
        <input
          value={cfg.url}
          placeholder="https://dav.jianguoyun.com/dav/Quill/"
          onChange={(e) => set({ url: e.target.value })}
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span>账号</span>
        <input value={cfg.user} onChange={(e) => set({ user: e.target.value })} autoComplete="off" spellCheck={false} />
      </label>
      <label className="field">
        <span>密码 / 应用专用密码</span>
        <input type="password" value={cfg.pass} onChange={(e) => set({ pass: e.target.value })} autoComplete="off" />
      </label>
      <p className="desc">密码保存在本机应用数据里（未加密），建议用服务商提供的「应用专用密码」而不是主密码。</p>

      <label className="sc-row">
        <div>
          <div className="sc-title">覆盖本地前先备份</div>
          <div className="sc-text">同步要用远端内容改写本地文档时，先做一次整库备份（没有覆盖就不备份）</div>
        </div>
        <input
          type="checkbox"
          checked={preBackup}
          onChange={(e) => {
            setPreBackup(e.target.checked)
            savePreBackup(e.target.checked)
          }}
        />
      </label>

      <div className="field-row">
        <button className="btn" disabled={!desktop || !!busy || !cfg.url.trim()} onClick={() => void test()}>
          {busy === 'test' ? '连接中…' : '测试连接'}
        </button>
        <button className="btn primary" disabled={!desktop || !!busy || !cfg.url.trim()} onClick={() => void sync()}>
          {busy === 'sync' ? step || '同步中…' : '立即同步'}
        </button>
      </div>
      {last && (
        <p className="desc">
          上次同步：{whenText(last.at)} · {last.summary}
        </p>
      )}
      {msg && (
        <div className={'webdav-msg' + (msg.ok ? ' ok' : ' bad')}>
          <div>{msg.text}</div>
          {msg.lines?.map((l, i) => (
            <div key={i} className="webdav-line">
              {l}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
