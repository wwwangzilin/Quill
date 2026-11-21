import { useEffect, useRef, useState } from 'react'
import { FONTS } from '../core/fonts'
import {
  READER_RANGE as R,
  READER_THEMES,
  defaultReaderStyle,
  type ReaderStyle,
} from '../core/readerStyle'

interface Props {
  style: ReaderStyle
  onChange: (next: ReaderStyle) => void
  /** 面板开合时通知外面：阅读视图要据此决定 Esc 先关谁 */
  onOpenChange?: (open: boolean) => void
}

/** 阅读视图里的「Aa」：配色 + 排版，改了当场生效，只影响阅读，不动编辑器 */
export default function ReaderStylePanel({ style, onChange, onOpenChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onOpenChange?.(open)
    if (!open) return
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 捕获阶段先收面板，别让 Esc 一路把整个阅读视图关了
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('pointerdown', down)
    window.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', down)
      window.removeEventListener('keydown', key, true)
    }
  }, [open, onOpenChange])

  const set = (patch: Partial<ReaderStyle>) => onChange({ ...style, ...patch })
  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    key: keyof ReaderStyle,
    show: string,
  ) => (
    <label>
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<ReaderStyle>)}
      />
      <em>{show}</em>
    </label>
  )

  return (
    <div className={'type-pop rstyle' + (open ? ' open' : '')} ref={ref}>
      <button
        type="button"
        className="type-pop-btn"
        title="阅读外观"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Aa
      </button>
      {open && (
        <div className="type-pop-panel rstyle-panel" role="dialog" aria-label="阅读外观">
          <div className="rstyle-themes" role="radiogroup" aria-label="阅读配色">
            {READER_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={style.theme === t.id}
                className={'rstyle-theme' + (style.theme === t.id ? ' on' : '')}
                onClick={() => set({ theme: t.id })}
                title={t.name}
              >
                <i style={{ background: t.swatch }} />
                <span>{t.name}</span>
              </button>
            ))}
          </div>
          <label>
            <span>字体</span>
            <select
              className="type-pop-font"
              value={style.font}
              onChange={(e) => set({ font: e.target.value })}
            >
              {FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          {slider('字号', style.size, R.minSize, R.maxSize, 1, 'size', String(style.size))}
          {slider('行距', style.leading, R.minLeading, R.maxLeading, 0.05, 'leading', style.leading.toFixed(2))}
          {slider('段距', style.gap, R.minGap, R.maxGap, 0.05, 'gap', style.gap.toFixed(2))}
          {slider('缩进', style.indent, 0, R.maxIndent, 1, 'indent', style.indent ? `${style.indent} 字` : '顶格')}
          {slider('边距', style.margin, R.minMargin, R.maxMargin, 4, 'margin', `${style.margin}`)}
          <div className="type-pop-foot">
            <div className="rstyle-cols" role="radiogroup" aria-label="栏数">
              {([1, 2] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={style.cols === n}
                  className={style.cols === n ? 'on' : ''}
                  onClick={() => set({ cols: n })}
                >
                  {n === 1 ? '单栏' : '双栏'}
                </button>
              ))}
            </div>
            <label className="type-pop-check">
              <input
                type="checkbox"
                checked={style.justify}
                onChange={(e) => set({ justify: e.target.checked })}
              />
              两端对齐
            </label>
            <button type="button" className="type-pop-reset" onClick={() => onChange(defaultReaderStyle())}>
              重置
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
