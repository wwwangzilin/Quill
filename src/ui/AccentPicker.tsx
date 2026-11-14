import { useState } from 'react'
import { ACCENT_PRESETS, isHexColor, readAccent, setAccent } from '../core/accent'
import { isDarkTheme, type Theme } from '../core/theme'

interface Props {
  /** 当前主题：强调色的明暗要按它来推 */
  theme: Theme
}

/** 自选色框里的初始色：还没选过时给个顺手的起点 */
const CUSTOM_FALLBACK = '#1f6f78'

/**
 * 强调色选择器：预设色块 + 自选 + 「跟随主题」。
 * 选了立刻生效、立刻存；所有状态都在 core/accent.ts，这里只管摆。
 */
export default function AccentPicker({ theme }: Props) {
  const [hex, setHex] = useState<string | null>(() => readAccent())
  const dark = isDarkTheme(theme)

  const pick = (v: string | null) => {
    setAccent(v, dark)
    setHex(v)
  }

  const isPreset = hex !== null && ACCENT_PRESETS.some((p) => p.hex === hex)

  return (
    <div className="accent-picker">
      <div className="accent-head">
        <span>强调色</span>
        <span className="accent-cur">{hex ? hex.toUpperCase() : '跟随主题'}</span>
      </div>
      <div className="accent-row" role="radiogroup" aria-label="强调色">
        <button
          type="button"
          role="radio"
          aria-checked={hex === null}
          className={'accent-chip auto' + (hex === null ? ' on' : '')}
          onClick={() => pick(null)}
          title="用各主题自带的点缀色"
        >
          <span className="accent-dot" />
          <span className="accent-name">跟随主题</span>
        </button>
        {ACCENT_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={hex === p.hex}
            className={'accent-chip' + (hex === p.hex ? ' on' : '')}
            onClick={() => pick(p.hex)}
            title={p.hex.toUpperCase()}
          >
            <span className="accent-dot" style={{ background: p.hex }} />
            <span className="accent-name">{p.label}</span>
          </button>
        ))}
        <label
          className={'accent-chip custom' + (hex !== null && !isPreset ? ' on' : '')}
          title="自己挑一个颜色"
        >
          <span
            className="accent-dot"
            style={{ background: hex !== null && !isPreset ? hex : undefined }}
          />
          <span className="accent-name">自选</span>
          <input
            type="color"
            value={hex ?? CUSTOM_FALLBACK}
            onChange={(e) => {
              // type="color" 只会给 #rrggbb；保险起见仍校验一次
              if (isHexColor(e.target.value)) pick(e.target.value.toLowerCase())
            }}
            aria-label="自选强调色"
          />
        </label>
      </div>
      <p className="accent-note">明暗会按当前主题自动调整，保证文字读得清。</p>
    </div>
  )
}
