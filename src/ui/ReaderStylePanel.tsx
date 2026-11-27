import { useEffect, useRef, useState } from 'react'
import { useAllFonts, addCustomFont, removeCustomFont } from '../core/customFonts'
import { toast } from './toast'
import {
  READER_RANGE as R,
  PAGE_TURNS,
  READER_THEMES,
  TAP_LAYOUTS,
  TURN_SPEEDS,
  defaultReaderStyle,
  type BookStyleCtl,
  type ReaderStyle,
} from '../core/readerStyle'

interface Props {
  style: ReaderStyle
  onChange: (next: ReaderStyle) => void
  /** 「仅这本书」开关；不给就不显示 */
  book?: BookStyleCtl
  /** 面板开合时通知外面：阅读视图要据此决定 Esc 先关谁 */
  onOpenChange?: (open: boolean) => void
}

/** 阅读视图里的「Aa」：配色 + 排版，改了当场生效，只影响阅读，不动编辑器 */
export default function ReaderStylePanel({ style, onChange, book, onOpenChange }: Props) {
  const [open, setOpen] = useState(false)
  const fonts = useAllFonts()
  const fileRef = useRef<HTMLInputElement>(null)
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
          {book && (
            <label className="type-pop-check rstyle-book" title="打开后，这本书的字体、字号、分栏等单独记住，不影响其他书">
              <input type="checkbox" checked={book.perBook} onChange={(e) => book.setPerBook(e.target.checked)} />
              仅这本书用这套排版
            </label>
          )}
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
              {fonts.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <div className="rstyle-row rstyle-font-tools">
            <span />
            <div className="rstyle-cols">
              <button type="button" onClick={() => fileRef.current?.click()} title="导入 .ttf / .otf / .woff / .woff2，存在本机">
                导入字体
              </button>
              {style.font.startsWith('custom-') && (
                <button
                  type="button"
                  onClick={() => {
                    const id = style.font
                    set({ font: defaultReaderStyle().font })
                    void removeCustomFont(id)
                  }}
                  title="删掉当前这个导入的字体"
                >
                  删除此字体
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                addCustomFont(f).then(
                  (o) => {
                    set({ font: o.id })
                    toast.success('字体已导入', o.name)
                  },
                  (err) => toast.error('导入失败', err instanceof Error ? err.message : '字体文件无法读取'),
                )
              }}
            />
          </div>
          <div className="rstyle-row">
            <span>字重</span>
            <div className="rstyle-cols" role="radiogroup" aria-label="字重">
              {([400, 500, 600, 700] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={style.weight === w}
                  className={style.weight === w ? 'on' : ''}
                  onClick={() => set({ weight: w })}
                >
                  {w === 400 ? '常规' : w === 500 ? '中' : w === 600 ? '半粗' : '粗'}
                </button>
              ))}
            </div>
          </div>
          {slider('字号', style.size, R.minSize, R.maxSize, 1, 'size', String(style.size))}
          {slider('行距', style.leading, R.minLeading, R.maxLeading, 0.05, 'leading', style.leading.toFixed(2))}
          {slider('段距', style.gap, R.minGap, R.maxGap, 0.05, 'gap', style.gap.toFixed(2))}
          {slider('缩进', style.indent, 0, R.maxIndent, 1, 'indent', style.indent ? `${style.indent} 字` : '顶格')}
          {slider('字距', style.track, R.minTrack, R.maxTrack, 0.01, 'track', `${style.track.toFixed(2)}`)}
          {slider('边距', style.margin, R.minMargin, R.maxMargin, 4, 'margin', `${style.margin}`)}
          <div className="rstyle-row">
            <span>排版</span>
            <div className="rstyle-cols" role="radiogroup" aria-label="横排或竖排">
              {([false, true] as const).map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  role="radio"
                  aria-checked={style.vertical === v}
                  className={style.vertical === v ? 'on' : ''}
                  onClick={() => set({ vertical: v })}
                  title={v ? '竖排：从右往左读，← 往后翻' : '横排'}
                >
                  {v ? '竖排' : '横排'}
                </button>
              ))}
            </div>
          </div>
          {!style.vertical && (
          <div className="rstyle-row">
            <span>分栏</span>
            <div className="rstyle-cols" role="radiogroup" aria-label="栏数">
              {(['auto', 1, 2, 3] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={style.cols === n}
                  className={style.cols === n ? 'on' : ''}
                  onClick={() => set({ cols: n })}
                >
                  {n === 'auto' ? '自动' : `${n} 栏`}
                </button>
              ))}
            </div>
          </div>
          )}
          <div className="rstyle-row">
            <span>翻页</span>
            <div className="rstyle-cols" role="radiogroup" aria-label="翻页动画">
              {PAGE_TURNS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={style.turn === t.id}
                  className={style.turn === t.id ? 'on' : ''}
                  onClick={() => set({ turn: t.id })}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
          {style.turn !== 'none' && (
            <div className="rstyle-row">
              <span>速度</span>
              <div className="rstyle-cols" role="radiogroup" aria-label="翻页速度">
                {TURN_SPEEDS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={style.speed === t.id}
                    className={style.speed === t.id ? 'on' : ''}
                    onClick={() => set({ speed: t.id })}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="rstyle-row">
            <span>点按</span>
            <div className="rstyle-cols" role="radiogroup" aria-label="点按分区">
              {TAP_LAYOUTS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={style.tap === t.id}
                  className={style.tap === t.id ? 'on' : ''}
                  onClick={() => set({ tap: t.id })}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
          <div className="type-pop-foot">
            <label className="type-pop-check">
              <input type="checkbox" checked={style.rule} onChange={(e) => set({ rule: e.target.checked })} />
              栏线
            </label>
            <label className="type-pop-check">
              <input
                type="checkbox"
                checked={style.justify}
                onChange={(e) => set({ justify: e.target.checked })}
              />
              两端对齐
            </label>
            {style.theme === 'paper' && (
              <label className="type-pop-check">
                <input
                  type="checkbox"
                  checked={style.paperTex}
                  onChange={(e) => set({ paperTex: e.target.checked })}
                />
                纸纹
              </label>
            )}
            <button type="button" className="type-pop-reset" onClick={() => onChange(defaultReaderStyle())}>
              重置
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
