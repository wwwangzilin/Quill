import BacklinksPanel from '../ui/BacklinksPanel'
import { goalProgress } from '../core/stats'
import { clampWidth, PROSE_RANGE } from '../core/fonts'
import type { Doc, DocMeta } from '../core/types'
import type { Saving } from './types'

interface Props {
  saving: Saving
  progress: ReturnType<typeof goalProgress>
  doc: Doc | null
  docs: DocMeta[]
  onOpenDoc: (id: string) => void
  proseWidth: number
  onProseWidth: (width: number) => void
}

/** 底部状态栏：保存状态、今日进度、反向链接、正文栏宽度 */
export default function StatusBar({
  saving,
  progress,
  doc,
  docs,
  onOpenDoc,
  proseWidth,
  onProseWidth,
}: Props) {
  return (
    <div className="statusbar">
    {/*
      底部状态栏：放「操作级」的信息 —— 保存状态、今日进度、正文栏宽度。
      顶部那行是「文档级」的（修改时间、总字数、段数、阅读时长），两边分工不重复。
    */}
      <span
        className={
          'sb-save' + (saving === 'saving' ? ' saving' : saving === 'saved' ? ' saved' : '')
        }
      >
        {saving === 'saving' ? '保存中…' : saving === 'saved' ? '✓ 已保存' : ''}
      </span>

      <span className="sb-item">
        今天 <b>{progress.today}</b> 字
      </span>

      {progress.goal > 0 && (
        <>
          <span className="sb-goal" title={`目标 ${progress.goal} 字`}>
            <span style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
          </span>
          <span className={'sb-item' + (progress.done ? ' done' : '')}>
            {progress.done ? '已达标 ✓' : `还差 ${progress.remain} 字`}
          </span>
        </>
      )}

      <span className="grow" />

      {/* 反向链接并进底栏，点开向上弹出，不再自己占正文底下的一行 */}
      {doc && (
        <BacklinksPanel
          doc={{ id: doc.id, title: doc.title }}
          docs={docs}
          onOpen={onOpenDoc}
        />
      )}

      <label className="width-slider" title="拖动调节正文栏宽度">
        <span className="ws-icon" aria-hidden="true">
          ⇔
        </span>
        <input
          type="range"
          min={PROSE_RANGE.minWidth}
          max={PROSE_RANGE.maxWidth}
          step={PROSE_RANGE.stepWidth}
          value={proseWidth}
          aria-label="正文栏宽度"
          onChange={(e) => onProseWidth(clampWidth(Number(e.target.value)))}
        />
        <em className="ws-val">{proseWidth}</em>
      </label>
    </div>
  )
}
