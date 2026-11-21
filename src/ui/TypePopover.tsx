import { useEffect, useRef, useState } from 'react'
import { FONTS, PROSE_DEFAULT, PROSE_RANGE, type ProseStyle } from '../core/fonts'

interface Props {
  prose: ProseStyle
  onProse: (next: ProseStyle) => void
}

/**
 * 状态栏里的「Aa」：写着写着觉得字大了、行距松了，不用跑去设置页，
 * 点一下就地拨，正文当场变 —— 排版参数和设置页是同一份，两边同步。
 */
export default function TypePopover({ prose, onProse }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const set = (patch: Partial<ProseStyle>) => onProse({ ...prose, ...patch })
  const maxIndent = PROSE_RANGE.indents[PROSE_RANGE.indents.length - 1]

  return (
    <div className={'type-pop' + (open ? ' open' : '')} ref={ref}>
      <button
        type="button"
        className="type-pop-btn"
        title="排版"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Aa
      </button>
      {open && (
        <div className="type-pop-panel" role="dialog" aria-label="排版">
          <label>
            <span>字体</span>
            <select
              className="type-pop-font"
              value={prose.font}
              onChange={(e) => set({ font: e.target.value })}
            >
              {FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>字号</span>
            <input
              type="range"
              min={PROSE_RANGE.minSize}
              max={PROSE_RANGE.maxSize}
              step={0.5}
              value={prose.size}
              onChange={(e) => set({ size: Number(e.target.value) })}
            />
            <em>{prose.size}</em>
          </label>
          <label>
            <span>行距</span>
            <input
              type="range"
              min={PROSE_RANGE.minLeading}
              max={PROSE_RANGE.maxLeading}
              step={0.05}
              value={prose.leading}
              onChange={(e) => set({ leading: Number(e.target.value) })}
            />
            <em>{prose.leading.toFixed(2)}</em>
          </label>
          <label>
            <span>段距</span>
            <input
              type="range"
              min={PROSE_RANGE.minGap}
              max={PROSE_RANGE.maxGap}
              step={0.05}
              value={prose.gap}
              onChange={(e) => set({ gap: Number(e.target.value) })}
            />
            <em>{prose.gap.toFixed(2)}</em>
          </label>
          <label>
            <span>缩进</span>
            <input
              type="range"
              min={0}
              max={maxIndent}
              step={1}
              value={prose.indent}
              onChange={(e) => set({ indent: Number(e.target.value) })}
            />
            <em>{prose.indent === 0 ? '顶格' : `${prose.indent} 字`}</em>
          </label>
          <div className="type-pop-foot">
            <label className="type-pop-check">
              <input
                type="checkbox"
                checked={prose.justify}
                onChange={(e) => set({ justify: e.target.checked })}
              />
              两端对齐
            </label>
            <button
              type="button"
              className="type-pop-reset"
              onClick={() =>
                set({
                  size: PROSE_DEFAULT.size,
                  leading: PROSE_DEFAULT.leading,
                  gap: PROSE_DEFAULT.gap,
                  indent: PROSE_DEFAULT.indent,
                  justify: PROSE_DEFAULT.justify,
                })
              }
            >
              恢复默认
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
