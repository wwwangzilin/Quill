import { useCallback, useEffect, useState } from 'react'
import { storage, type RemoteInfo } from '../core/storage'
import {
  clampWidth,
  FONTS,
  PROSE_DEFAULT,
  PROSE_RANGE,
  fontInstalled,
  fontOption,
  type ProseStyle,
} from '../core/fonts'
import {
  AI_DEFAULTS,
  aiAvailable,
  aiModels,
  aiSave,
  aiStatus,
  aiStream,
  guessModels,
  type AiStatus,
} from '../core/ai'
import { AI_TUNING_RANGE, resetAiTuning, useAiTuning } from '../core/aiPrefs'
import { applyRespectMotion, readRespectMotion } from '../core/motion'
import { THEMES, type Theme } from '../core/theme'
import { isDesktop, type DesktopPrefs } from '../core/desktop'
import { checkUpdate, currentVersion, installUpdate, type UpdateInfo } from '../core/update'
import { toast } from './toast'

type SectionId = 'appearance' | 'writing' | 'ai' | 'backup' | 'desktop' | 'about'

interface Props {
  onClose: () => void
  theme: Theme
  onTheme: (next: Theme) => void
  autoHide: boolean
  onAutoHide: (next: boolean) => void
  prose: ProseStyle
  onProse: (next: ProseStyle) => void
  aiEnabled: boolean
  onAiEnabled: (next: boolean) => void
  aiDelay: number
  onAiDelay: (next: number) => void
  goal: number
  onGoal: (next: number) => void
  desk: DesktopPrefs
  onDesk: (next: DesktopPrefs) => void
  autostart: boolean
  onAutostart: (next: boolean) => void
}

const SECTIONS: { id: SectionId; label: string; hint: string; desktopOnly?: boolean }[] = [
  { id: 'appearance', label: '外观', hint: '字体与排版' },
  { id: 'writing', label: '写作', hint: '每日目标' },
  { id: 'ai', label: 'AI 助手', hint: '续写与密钥' },
  { id: 'backup', label: '远程备份', hint: '推送到 git 仓库' },
  { id: 'desktop', label: '桌面', hint: '托盘与同步', desktopOnly: true },
  { id: 'about', label: '关于', hint: '版本与更新' },
]

/**
 * 设置界面。
 *
 * 独立占满主区域，左侧分类导航、右侧内容区 —— 不做成悬浮弹窗：
 * 配置项已经有六组，挤在一个小窗口里既难找也不像样。
 */
export default function SettingsView({
  onClose,
  theme,
  onTheme,
  autoHide,
  onAutoHide,
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
  const [section, setSection] = useState<SectionId>('appearance')

  /* ---- 远程备份 ---- */
  const [url, setUrl] = useState('')
  const [ca, setCa] = useState('')
  const [token, setToken] = useState('')
  const [info, setInfo] = useState<RemoteInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')

  /* ---- AI 助手 ---- */
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [aiUrl, setAiUrl] = useState(AI_DEFAULTS.baseUrl)
  const [aiModel, setAiModel] = useState(AI_DEFAULTS.model)
  const [aiKey, setAiKey] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiLog, setAiLog] = useState('')
  /** 是否跟随系统的「减少动效」—— 默认否，动画照常播 */
  const [respectMotion, setRespectMotion] = useState(readRespectMotion)

  /** 生成参数：拖一下即时生效，不必等「保存设置」 */
  const [tuning, setTuning] = useAiTuning()
  /** 模型候选：先按地址猜几个，也可以从接口拉真实列表 */
  const [modelOpen, setModelOpen] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [modelBusy, setModelBusy] = useState(false)
  const [modelPulled, setModelPulled] = useState(false)

  /* ---- 关于与更新 ---- */
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState(0)

  const option = fontOption(prose.font)
  const installed = fontInstalled(option)
  const hasRemote = Boolean(info?.url)

  const desktop = isDesktop()
  const sections = SECTIONS.filter((s) => !s.desktopOnly || desktop)

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
    void reload()
    void currentVersion()
      .then(setVersion)
      .catch(() => {})
  }, [reload])

  // 密钥不会回显，只读一个「配没配过」的状态
  useEffect(() => {
    void (async () => {
      const s = await aiStatus()
      if (!s) return
      setAi(s)
      setAiUrl(s.baseUrl)
      setAiModel(s.model)
    })()
  }, [])

  // 接口地址一改，之前拉来的列表就不作数了，退回按地址猜的那几个
  useEffect(() => {
    setModelPulled(false)
    setModels(guessModels(aiUrl))
  }, [aiUrl])

  // 点别处就把下拉收起来
  useEffect(() => {
    if (!modelOpen) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.model-pick')) setModelOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [modelOpen])

  /* ---------------- 远程备份 ---------------- */

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

  /* ---------------- AI 助手 ---------------- */

  /** 从接口拉真实模型列表 —— 这是唯一不会过时的来源 */
  const pullModels = async () => {
    setModelBusy(true)
    try {
      const list = await aiModels(aiUrl.trim())
      setModels(list)
      setModelPulled(true)
      setModelOpen(true)
      toast.success(`拿到 ${list.length} 个模型`, '点一个填进输入框')
    } catch (err) {
      toast.error('拉取模型列表失败', String(err).slice(0, 150))
    } finally {
      setModelBusy(false)
    }
  }

  const saveAi = async () => {
    setAiBusy(true)
    setAiLog('')
    try {
      const s = await aiSave(aiUrl.trim(), aiModel.trim(), aiKey.trim() || undefined)
      setAi(s)
      setAiKey('')
      toast.success('AI 设置已保存', s.hasKey ? '密钥已存入本机配置目录' : '尚未填写 API Key')
      return true
    } catch (err) {
      setAiLog(String(err))
      toast.error('AI 设置保存失败', String(err).slice(0, 120))
      return false
    } finally {
      setAiBusy(false)
    }
  }

  /** 先存再测，避免测的是没保存的旧配置 */
  const testAi = async () => {
    setAiBusy(true)
    setAiLog('正在请求模型…')
    try {
      await aiSave(aiUrl.trim(), aiModel.trim(), aiKey.trim() || undefined)
      setAiKey('')
      const out = await aiStream(
        {
          system: '你是连通性测试助手。',
          prompt: '只回复两个字：可用',
          maxTokens: 16,
          temperature: 0,
        },
        () => {},
      )
      setAiLog(`连接成功，模型回复：${out.trim() || '空'}`)
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

  /* ---------------- 检查更新 ---------------- */

  const doCheck = async () => {
    setChecking(true)
    try {
      const found = await checkUpdate()
      setUpdate(found)
      if (found) toast.info(`发现新版本 ${found.version}`, '可以下载安装')
      else toast.success('已经是最新版', version ? `当前 ${version}` : '')
    } catch (err) {
      // 网络不通、代理拦截都会走到这里 —— 如实报错，不假装已经是最新
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
      // 装完会自行重启，走不到这里
    } catch (err) {
      toast.error('安装更新失败', String(err).slice(0, 140))
      setInstalling(false)
    }
  }

  /* ---------------- 各分区 ---------------- */

  const appearance = (
    <>
      <p className="desc">
        主题决定配色、圆角与阴影；正文用哪套字体字号，在下面单独调。
      </p>

      <div className="theme-grid">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={'theme-card' + (t.id === theme ? ' on' : '')}
            onClick={() => onTheme(t.id)}
          >
            <span className="theme-dots">
              <span style={{ background: t.swatch[0] }} />
              <span style={{ background: t.swatch[1] }} />
            </span>
            <span className="theme-name">
              {t.icon} {t.label}
            </span>
            <span className="theme-hint">{t.hint}</span>
          </button>
        ))}
      </div>

      <label className="field" style={{ marginTop: 14 }}>
        <span>正文字体</span>
        <select value={prose.font} onChange={(e) => onProse({ ...prose, font: e.target.value })}>
          {FONTS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        {option.hint}
        {!option.probe
          ? ''
          : installed
            ? '　本机已安装。'
            : option.cdn
              ? '　本机未安装，将从 CDN 按需加载字形。'
              : '　本机未安装，将回退到系统字体。'}
      </p>

      <label className="sc-row" style={{ cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={respectMotion}
          onChange={(e) => {
            setRespectMotion(e.target.checked)
            applyRespectMotion(e.target.checked)
          }}
          style={{ width: 14, height: 14 }}
        />
        <span className="sc-text">跟随系统的动画设置</span>
      </label>
      <p className="hint">
        默认关闭：界面里的过渡是设计的一部分，系统关掉了动效这里也照常播放 ——
        否则面板会直接跳出来、列表会硬切，看着像没做完。确有需要（例如对动效敏感）再打开它。
      </p>

      <label className="field">
        <span>
          正文字号
          <em className="val">{prose.size} px</em>
        </span>
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
        <span>
          行距
          <em className="val">{prose.leading.toFixed(2)}</em>
        </span>
        <input
          type="range"
          min={PROSE_RANGE.minLeading}
          max={PROSE_RANGE.maxLeading}
          step={0.05}
          value={prose.leading}
          onChange={(e) => onProse({ ...prose, leading: Number(e.target.value) })}
        />
      </label>

      <label className="field">
        <span>
          正文栏宽度
          <em className="val">{prose.width} px</em>
        </span>
        <input
          type="range"
          min={PROSE_RANGE.minWidth}
          max={PROSE_RANGE.maxWidth}
          step={PROSE_RANGE.stepWidth}
          value={prose.width}
          onChange={(e) => onProse({ ...prose, width: clampWidth(Number(e.target.value)) })}
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

      <div className="field-row">
        <button className="btn" onClick={() => onProse({ ...PROSE_DEFAULT })}>
          恢复默认
        </button>
        <span className="grow" />
        <span className="note">正文、便签、磁贴三处同步生效；宽度也能直接拖标题栏上的滑块</span>
      </div>
    </>
  )

  const writing = (
    <>
      <label className="sc-row" style={{ cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={autoHide}
          onChange={(e) => onAutoHide(e.target.checked)}
          style={{ width: 14, height: 14 }}
        />
        <span className="sc-text">自动收起顶栏与底栏</span>
      </label>
      <p className="hint">
        窗口没有系统边框，顶栏也就不常驻了 —— 鼠标移到右上角它才滑出来
        （窗口按钮在那儿），离开一会儿自己收回去；状态栏与侧栏则在正文里敲字时收起、
        鼠标一动就回来。关掉这一项，界面就一直摆着不动。
        阅读模式与禅模式本来就收界面，不受这里影响。
      </p>
      <label className="field">
        <span>
          每日写作目标
          <em className="val">{goal > 0 ? `${goal} 字` : '不设目标'}</em>
        </span>
        <input
          type="range"
          min={0}
          max={3000}
          step={100}
          value={goal}
          onChange={(e) => onGoal(Number(e.target.value))}
        />
      </label>
      <p className="hint">
        侧栏显示当日进度与连续写作天数。设为 0 表示不设目标。
      </p>
    </>
  )

  const aiSection = (
    <>
      <p className="desc">
        停止输入后，模型依据上文生成一段灰色提示文本。按 Tab 接受，按 Esc 忽略；
        不接受则不会写入文档。该功能默认关闭，开启后按调用次数计费。
        下方的长度与创意度改动即时生效，不必点保存。
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
          {aiAvailable() ? '启用行内续写，快捷键 Alt+/ 可随时手动触发' : '仅桌面版可用'}
        </span>
      </label>

      <label className="field" style={{ marginTop: 12 }}>
        <span>接口地址</span>
        <input
          value={aiUrl}
          onChange={(e) => setAiUrl(e.target.value)}
          placeholder={AI_DEFAULTS.baseUrl}
          spellCheck={false}
        />
      </label>
      <p className="hint">兼容 OpenAI 的 /chat/completions 接口。</p>

      <label className="field">
        <span>API Key</span>
        <input
          value={aiKey}
          type="password"
          onChange={(e) => setAiKey(e.target.value)}
          placeholder={ai?.hasKey ? '已保存在本机，留空表示不改动' : 'sk-…'}
          spellCheck={false}
        />
      </label>
      <p className="hint">密钥只写入本机配置目录，不会进入文档仓库。</p>

      {/* 模型：既能手打（中转的模型名千奇百怪），也能从接口拉一份真实列表来选 */}
      <div className="field">
        <span>模型</span>
        <div className="model-pick">
          <input
            value={aiModel}
            onChange={(e) => setAiModel(e.target.value)}
            placeholder={AI_DEFAULTS.model}
            spellCheck={false}
            onFocus={() => setModelOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setModelOpen(false)
            }}
          />
          <button
            type="button"
            className={'model-caret' + (modelOpen ? ' open' : '')}
            onClick={() => setModelOpen((v) => !v)}
            title="选择模型"
          >
            ▾
          </button>

          {modelOpen && (
            <div className="model-menu">
              <div className="model-menu-head">
                <span className="model-menu-title">
                  {modelPulled ? `接口返回 ${models.length} 个` : '常见模型'}
                </span>
                <span className="grow" />
                <button
                  type="button"
                  className="model-pull"
                  onClick={() => void pullModels()}
                  disabled={modelBusy}
                >
                  {modelBusy ? '获取中…' : '↻ 从接口获取'}
                </button>
              </div>
              <div className="model-menu-body">
                {models.length === 0 ? (
                  <p className="model-empty">
                    这个地址猜不出常见模型，点上面的「从接口获取」拉一份真实列表。
                  </p>
                ) : (
                  models.map((m) => (
                    <button
                      type="button"
                      key={m}
                      className={'model-item' + (m === aiModel ? ' on' : '')}
                      onClick={() => {
                        setAiModel(m)
                        setModelOpen(false)
                      }}
                    >
                      {m}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <label className="field">
        <span>
          触发延迟
          <em className="val">{aiDelay} ms</em>
        </span>
        <input
          type="range"
          min={300}
          max={2500}
          step={100}
          value={aiDelay}
          onChange={(e) => onAiDelay(Number(e.target.value))}
        />
      </label>

      <label className="field">
        <span>
          续写长度
          <em className="val">{tuning.continueTokens} tokens</em>
        </span>
        <input
          type="range"
          min={AI_TUNING_RANGE.continue.min}
          max={AI_TUNING_RANGE.continue.max}
          step={AI_TUNING_RANGE.continue.step}
          value={tuning.continueTokens}
          onChange={(e) => setTuning({ continueTokens: Number(e.target.value) })}
        />
      </label>

      <label className="field">
        <span>
          改写长度
          <em className="val">{tuning.rewriteTokens} tokens</em>
        </span>
        <input
          type="range"
          min={AI_TUNING_RANGE.rewrite.min}
          max={AI_TUNING_RANGE.rewrite.max}
          step={AI_TUNING_RANGE.rewrite.step}
          value={tuning.rewriteTokens}
          onChange={(e) => setTuning({ rewriteTokens: Number(e.target.value) })}
        />
      </label>

      <label className="field">
        <span>
          回答长度
          <em className="val">{tuning.answerTokens} tokens</em>
        </span>
        <input
          type="range"
          min={AI_TUNING_RANGE.answer.min}
          max={AI_TUNING_RANGE.answer.max}
          step={AI_TUNING_RANGE.answer.step}
          value={tuning.answerTokens}
          onChange={(e) => setTuning({ answerTokens: Number(e.target.value) })}
        />
      </label>
      <p className="hint">
        三者依次对应行内续写、选中改写、全文问答的单次输出上限。中文大致一个字一个 token；
        结果被截断时界面上会给出提示，把对应数值调高即可。
      </p>

      <label className="field">
        <span>
          创意度
          <em className="val">{tuning.temperature.toFixed(2)}</em>
        </span>
        <input
          type="range"
          min={AI_TUNING_RANGE.temperature.min}
          max={AI_TUNING_RANGE.temperature.max}
          step={AI_TUNING_RANGE.temperature.step}
          value={tuning.temperature}
          onChange={(e) => setTuning({ temperature: Number(e.target.value) })}
        />
      </label>
      <p className="hint">越低越稳定保守，越高越灵活。改写与问答偏保守更准，续写可以高一些。</p>

      <label className="field">
        <span>额外写作要求</span>
        <textarea
          value={tuning.style}
          rows={3}
          placeholder="例：文风克制，少用四字成语；人称统一用「我」"
          spellCheck={false}
          onChange={(e) => setTuning({ style: e.target.value })}
        />
      </label>
      <p className="hint">
        以上参数与要求改动后立即生效，不需要点保存。额外要求会追加到续写、改写、问答三条系统提示词末尾。
      </p>

      <div className="field-row">
        <button className="btn" onClick={() => setTuning(resetAiTuning())}>
          恢复默认参数
        </button>
      </div>

      <div className="field-row">
        <button className="btn primary" onClick={() => void saveAi()} disabled={aiBusy}>
          保存设置
        </button>
        <button className="btn" onClick={() => void testAi()} disabled={aiBusy}>
          {aiBusy ? '处理中…' : '测试连接'}
        </button>
        <span className="grow" />
        <span className="note">{ai?.hasKey ? '密钥已配置' : '尚未配置密钥'}</span>
      </div>

      {aiLog && (
        <pre className="preview" style={{ maxHeight: 140, marginTop: 10 }}>
          {aiLog}
        </pre>
      )}
    </>
  )

  const backup = (
    <>
      <p className="desc">
        将文档仓库推送至远程私有仓库，支持 GitHub、Gitea 或自建服务。
        文档为纯 Markdown 格式，任何 git 客户端均可读取。
      </p>

      <label className="field">
        <span>远程地址</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/用户名/quill-notes.git"
          spellCheck={false}
        />
      </label>

      <label className="field">
        <span>访问令牌</span>
        <input
          value={token}
          type="password"
          onChange={(e) => setToken(e.target.value)}
          placeholder={info?.hasToken ? '已保存，留空表示不改动' : '选填'}
          spellCheck={false}
        />
      </label>

      <label className="field">
        <span>CA 证书包</span>
        <input
          value={ca}
          onChange={(e) => setCa(e.target.value)}
          placeholder="选填。仅在代理或自签证书拦截时需要，填写合并后的 crt 路径"
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
        <span className="note">
          {info?.ahead == null
            ? hasRemote
              ? '未获取上游状态'
              : '尚未配置'
            : info.ahead > 0
              ? `${info.ahead} 个提交待推送`
              : '本地与远程同步'}
        </span>
      </div>

      {log && (
        <pre className="preview" style={{ maxHeight: 160, marginTop: 12 }}>
          {log}
        </pre>
      )}
    </>
  )

  const desktopSection = (
    <>
      <p className="desc">
        应用可驻留系统托盘并在后台运行，便于随时记录。
      </p>

      <label className="sc-row" style={{ cursor: 'pointer' }}>
        <span>
          关闭窗口时收进系统托盘
          <div className="hint">
            关闭主窗口后应用继续在后台运行，快速便签快捷键保持可用
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
          <div className="hint">登录系统后自动启动，并驻留系统托盘</div>
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
          <div className="hint">按设定间隔自动提交并推送，失败时给出提示</div>
        </span>
        <input
          type="checkbox"
          checked={desk.autoSync}
          onChange={(e) => onDesk({ ...desk, autoSync: e.target.checked })}
        />
      </label>

      {desk.autoSync && (
        <label className="field" style={{ marginTop: 12 }}>
          <span>
            同步间隔
            <em className="val">{desk.syncMinutes} 分钟</em>
          </span>
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

      <div className="sc-group-divider" />

      <div className="sc-title">存储位置</div>
      <p className="desc">
        文档以纯 <code>.md</code> 文件存放在 <code>{storage.label}</code>，每次保存自动产生一次 git 提交。
      </p>
      <div className="field-row">
        <button className="btn" onClick={() => void storage.reveal()}>
          在资源管理器中打开
        </button>
      </div>
    </>
  )

  const about = (
    <>
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
            可更新至 <b>{update.version}</b>
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

      <p className="desc" style={{ marginTop: 14 }}>
        更新包使用 minisign 签名校验，安装前会验证来源；校验不通过将拒绝安装。
      </p>
    </>
  )

  const body = {
    appearance,
    writing,
    ai: aiSection,
    backup,
    desktop: desktopSection,
    about,
  }[section]

  const current = sections.find((s) => s.id === section) ?? sections[0]

  return (
    <div className="settings-view">
      <div className="settings-head">
        <button className="btn ghost icon" onClick={onClose} title="返回">
          ←
        </button>
        <div className="settings-title">设置</div>
        <span className="grow" />
        <span className="note">Esc 返回</span>
      </div>

      <div className="settings-body">
        <nav className="settings-nav">
          {sections.map((s) => (
            <button
              key={s.id}
              className={'settings-nav-item' + (s.id === section ? ' on' : '')}
              onClick={() => setSection(s.id)}
            >
              <span className="label">{s.label}</span>
              <span className="hint">{s.hint}</span>
            </button>
          ))}
        </nav>

        <div className="settings-content">
          <div className="settings-section">
            <h3>{current?.label}</h3>
            <div className="sc-group">{body}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
