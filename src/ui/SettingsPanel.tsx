import { useCallback, useEffect, useState } from 'react'
import { storage, type RemoteInfo } from '../core/storage'
import {
  FONTS,
  PROSE_RANGE,
  fontInstalled,
  fontOption,
  type ProseStyle,
} from '../core/fonts'
import { AI_DEFAULTS, aiAvailable, aiSave, aiStatus, aiStream, type AiStatus } from '../core/ai'
import { isDesktop, type DesktopPrefs } from '../core/desktop'
import { checkUpdate, currentVersion, installUpdate, type UpdateInfo } from '../core/update'
import { toast } from './toast'

interface Props {
  open: boolean
  onClose: () => void
  prose: ProseStyle
  onProse: (next: ProseStyle) => void
  aiEnabled: boolean
  onAiEnabled: (next: boolean) => void
  aiDelay: number
  onAiDelay: (next: number) => void
  goal: number
  onGoal: (next: number) => void
  /** 桌面版行为偏好（浏览器模式给默认值即可） */
  desk: DesktopPrefs
  onDesk: (next: DesktopPrefs) => void
  /** 开机自启：系统里的事实 */
  autostart: boolean
  onAutostart: (next: boolean) => void
}

export default function SettingsPanel({
  open,
  onClose,
  prose,
  onProse,
  aiEnabled,
  onAiEnabled,
  aiDelay,
  onAiDelay,
  goal,
  onGoal,
  desk,
  onDesk,
  autostart,
  onAutostart,
}: Props) {
  const [url, setUrl] = useState('')
  const [ca, setCa] = useState('')
  const [token, setToken] = useState('')
  const [info, setInfo] = useState<RemoteInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')

  /* ---- 自动更新 ---- */
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!open) return
    void currentVersion()
      .then(setVersion)
      .catch(() => {})
  }, [open])

  const doCheck = async () => {
    setChecking(true)
    try {
      const info = await checkUpdate()
      setUpdate(info)
      if (info) toast.info(`发现新版本 ${info.version}`, '可以下载安装')
      else toast.success('已经是最新版', version ? `当前 ${version}` : '')
    } catch (err) {
      // 网络不通、代理拦了都会走到这儿 —— 如实说，别假装"已是最新"
      toast.error('检查更新失败', String(err).slice(0, 140))
    } finally {
      setChecking(false)
    }
  }

  const doInstall = async () => {
    setInstalling(true)
    setProgress(0)
    try {
      await installUpdate((done, total) => {
        setProgress(total > 0 ? Math.round((done / total) * 100) : 0)
      })
      // 装完会 relaunch，走不到这儿
    } catch (err) {
      toast.error('安装更新失败', String(err).slice(0, 140))
      setInstalling(false)
    }
  }

  // AI 续写
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [aiUrl, setAiUrl] = useState(AI_DEFAULTS.baseUrl)
  const [aiModel, setAiModel] = useState(AI_DEFAULTS.model)
  const [aiKey, setAiKey] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiLog, setAiLog] = useState('')

  const option = fontOption(prose.font)
  const installed = fontInstalled(option)

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

  // 打开面板时读一次 AI 设置（key 不会回显，只看有没有配过）
  useEffect(() => {
    if (!open) return
    setAiLog('')
    setAiKey('')
    void (async () => {
      const s = await aiStatus()
      if (!s) return
      setAi(s)
      setAiUrl(s.baseUrl)
      setAiModel(s.model)
    })()
  }, [open])

  if (!open) return null

  /** 保存 AI 设置（key 留空表示不改动原来那个） */
  const saveAi = async () => {
    setAiBusy(true)
    setAiLog('')
    try {
      const s = await aiSave(aiUrl.trim(), aiModel.trim(), aiKey.trim() || undefined)
      setAi(s)
      setAiKey('')
      toast.success('AI 设置已保存', s.hasKey ? 'Key 已存到本机配置目录' : '还没填 API Key')
      return true
    } catch (err) {
      setAiLog(String(err))
      toast.error('AI 设置保存失败', String(err).slice(0, 120))
      return false
    } finally {
      setAiBusy(false)
    }
  }

  /** 先存再测：免得测的是没保存的旧配置 */
  const testAi = async () => {
    setAiBusy(true)
    setAiLog('正在请求模型…')
    try {
      await aiSave(aiUrl.trim(), aiModel.trim(), aiKey.trim() || undefined)
      setAiKey('')
      const out = await aiStream(
        { system: '你是连通性测试助手。', prompt: '只回复两个字：可用', maxTokens: 16, temperature: 0 },
        () => {},
      )
      setAiLog(`连接成功，模型回复：${out.trim() || '（空）'}`)
      toast.success('AI 接口连通')
      const s = await aiStatus()
      if (s) setAi(s)
    } catch (err) {
      setAiLog(`连接失败：${String(err)}`)
      toast.error('AI 接口不通', String(err).slice(0, 120))
    } finally {
      setAiBusy(false)
    }
  }

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
            <div className="sc-title">关于</div>
            <div className="sc-row">
              <span>
                当前版本
                <div className="hint">{version || '读取中…'}</div>
              </span>
              <button className="btn" disabled={checking} onClick={() => void doCheck()}>
                {checking ? '检查中…' : '检查更新'}
              </button>
            </div>
            {update && (
              <div className="update-card">
                <div className="update-head">
                  有新版本 <b>{update.version}</b>
                  <span className="grow" />
                  <button className="btn primary" disabled={installing} onClick={() => void doInstall()}>
                    {installing ? '下载中…' : '下载并安装'}
                  </button>
                </div>
                {installing && (
                  <div className="update-bar">
                    <span style={{ width: `${progress}%` }} />
                  </div>
                )}
                {update.notes && <div className="update-notes">{update.notes}</div>}
              </div>
            )}
          </div>

          {isDesktop() && (
            <div className="sc-group">
              <div className="sc-title">桌面</div>

              <label className="sc-row" style={{ cursor: 'pointer' }}>
                <span>
                  关闭窗口时收进托盘
                  <div className="hint">
                    保持后台运行 —— Ctrl+Space 快速便签才不会随主窗口一起失效
                  </div>
                </span>
                <input
                  type="checkbox"
                  checked={desk.closeToTray}
                  onChange={(e) => onDesk({ ...desk, closeToTray: e.target.checked })}
                />
              </label>

              <label className="sc-row" style={{ cursor: 'pointer' }}>
                <span>
                  开机自动启动
                  <div className="hint">登录后就在托盘待命，随手就能记一笔</div>
                </span>
                <input
                  type="checkbox"
                  checked={autostart}
                  onChange={(e) => onAutostart(e.target.checked)}
                />
              </label>

              <label className="sc-row" style={{ cursor: 'pointer' }}>
                <span>
                  定时同步到远程仓库
                  <div className="hint">自动提交并推送；失败会弹提示，不会悄悄咽掉</div>
                </span>
                <input
                  type="checkbox"
                  checked={desk.autoSync}
                  onChange={(e) => onDesk({ ...desk, autoSync: e.target.checked })}
                />
              </label>

              {desk.autoSync && (
                <label className="field" style={{ marginTop: 10 }}>
                  <span>同步间隔 · 每 {desk.syncMinutes} 分钟</span>
                  <input
                    type="range"
                    min={5}
                    max={180}
                    step={5}
                    value={desk.syncMinutes}
                    onChange={(e) => onDesk({ ...desk, syncMinutes: Number(e.target.value) })}
                  />
                </label>
              )}
            </div>
          )}

          <div className="sc-group">
            <div className="sc-title">外观</div>

            <label className="field">
              <span>正文字体</span>
              <select
                value={prose.font}
                onChange={(e) => onProse({ ...prose, font: e.target.value })}
              >
                {FONTS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="hint" style={{ marginBottom: 10 }}>
              {option.hint}
              {!option.probe
                ? ''
                : installed
                  ? '（这台机器上已经有了）'
                  : option.cdn
                    ? '（本机没装，正从 CDN 按需取字形，只下用到的字）'
                    : '（本机没装，会回退到系统字体）'}
            </div>

            <label className="field">
              <span>正文字号 · {prose.size}px</span>
              <input
                type="range"
                min={PROSE_RANGE.minSize}
                max={PROSE_RANGE.maxSize}
                step={0.5}
                value={prose.size}
                onChange={(e) => onProse({ ...prose, size: Number(e.target.value) })}
              />
            </label>

            <label className="field">
              <span>行距 · {prose.leading.toFixed(2)}</span>
              <input
                type="range"
                min={PROSE_RANGE.minLeading}
                max={PROSE_RANGE.maxLeading}
                step={0.05}
                value={prose.leading}
                onChange={(e) => onProse({ ...prose, leading: Number(e.target.value) })}
              />
            </label>

            <div
              className="font-preview"
              style={{
                fontFamily: option.stack,
                fontSize: `${prose.size}px`,
                lineHeight: prose.leading,
              }}
            >
              从前有座山，山里有座庙。The quick brown fox jumps over the lazy dog. 1234567890
            </div>

            <div className="field-row" style={{ marginTop: 10 }}>
              <button
                className="btn"
                onClick={() => onProse({ font: 'system', size: 16.5, leading: 1.85 })}
              >
                恢复默认
              </button>
              <span className="grow" />
              <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                正文、便签、磁贴三处同步生效
              </span>
            </div>
          </div>

          <div className="sc-group">
            <div className="sc-title">写作</div>
            <label className="field">
              <span>每日字数目标 · {goal > 0 ? `${goal} 字` : '不设目标'}</span>
              <input
                type="range"
                min={0}
                max={3000}
                step={100}
                value={goal}
                onChange={(e) => onGoal(Number(e.target.value))}
              />
            </label>
            <div className="hint">
              侧栏会显示今天写了多少、还差多少，以及连续写了多少天。拖到 0 就是不设目标。
            </div>
          </div>

          <div className="sc-group">
            <div className="sc-title">AI 续写</div>
            <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.8, marginBottom: 12 }}>
              停手一会儿后，模型会顺着上文给一小段灰色提示：<b>Tab</b> 接受、<b>Esc</b> 忽略，
              不要就等于什么都没发生。默认关闭 —— 这东西是按次花钱的，开不开主人自己定。
            </p>

            <label className="sc-row" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={aiEnabled}
                disabled={!aiAvailable()}
                onChange={(e) => onAiEnabled(e.target.checked)}
                style={{ width: 14, height: 14 }}
              />
              <span className="sc-text">
                {aiAvailable() ? '启用行内续写（Alt+/ 随时手动要一次）' : '桌面版才有（网页版发不了请求）'}
              </span>
            </label>

            <label className="field" style={{ marginTop: 10 }}>
              <span>接口地址（兼容 OpenAI 的 /chat/completions）</span>
              <input
                value={aiUrl}
                onChange={(e) => setAiUrl(e.target.value)}
                placeholder={AI_DEFAULTS.baseUrl}
                spellCheck={false}
              />
            </label>

            <label className="field">
              <span>API Key</span>
              <input
                value={aiKey}
                type="password"
                onChange={(e) => setAiKey(e.target.value)}
                placeholder={
                  ai?.hasKey ? '已保存在本机（留空则不改动）' : 'sk-…（只写进本机配置目录，不进文档仓库）'
                }
                spellCheck={false}
              />
            </label>

            <label className="field">
              <span>模型</span>
              <input
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                placeholder={AI_DEFAULTS.model}
                spellCheck={false}
              />
            </label>

            <label className="field">
              <span>停手多久才请求 · {aiDelay} ms</span>
              <input
                type="range"
                min={300}
                max={2500}
                step={100}
                value={aiDelay}
                onChange={(e) => onAiDelay(Number(e.target.value))}
              />
            </label>

            <div className="field-row">
              <button className="btn primary" onClick={() => void saveAi()} disabled={aiBusy}>
                保存 AI 设置
              </button>
              <button className="btn" onClick={() => void testAi()} disabled={aiBusy}>
                {aiBusy ? '处理中…' : '测试连接'}
              </button>
              <span className="grow" />
              <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                {ai?.hasKey ? 'Key 已配置' : '还没配置 Key'}
              </span>
            </div>

            {aiLog && (
              <pre className="preview" style={{ maxHeight: 140, marginTop: 10 }}>
                {aiLog}
              </pre>
            )}
          </div>

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
