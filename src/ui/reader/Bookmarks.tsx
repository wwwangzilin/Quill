/**
 * 阅读器工具栏上的「书签」小件：加/取消当前屏的书签、书签列表、按分类筛选。
 *
 * 从 ReaderView.tsx 里搬出来的 —— 那块 JSX 有八十多行，跟分页、朗读、
 * 章规则混在一起，改一处得先在一千多行里找到它。这里只负责画，状态仍在阅读器里。
 */
import { Icon } from '../Icon'
import { BM_CATS, type BmCat, type Bookmark } from '../../core/bookmarks'

interface Props {
  /** 当前这一屏有没有书签 */
  marked: boolean
  /** 全部书签（用来显示计数、筛选统计） */
  bms: Bookmark[]
  /** 筛选之后要显示的 */
  shown: Bookmark[]
  open: boolean
  filter: BmCat | 'all' | 'none'
  /** 每个分类下有几条 */
  catStat: Record<string, number>
  onFlip: () => void
  onToggleOpen: () => void
  onFilter: (f: BmCat | 'all' | 'none') => void
  onCycleCat: (id: string) => void
  onGo: (b: Bookmark) => void
  onDrop: (id: string) => void
}

export default function Bookmarks({
  marked,
  bms,
  shown,
  open,
  filter,
  catStat,
  onFlip,
  onToggleOpen,
  onFilter,
  onCycleCat,
  onGo,
  onDrop,
}: Props) {
  return (
    <div className="reader-bm">
      <button
        className={'btn ghost icon' + (marked ? ' on' : '')}
        onClick={onFlip}
        title={marked ? '取消这一屏的书签' : '给这一屏加书签'}
      >
        <Icon name="bookmark" />
      </button>
      <button
        className={'btn ghost reader-bm-count' + (open ? ' on' : '')}
        onClick={onToggleOpen}
        disabled={!bms.length}
        title="书签列表"
        aria-expanded={open}
      >
        {bms.length}
      </button>
      {open && (
        <div className="reader-bm-list">
          <div className="reader-bm-filter" role="radiogroup" aria-label="书签分类">
            {(['all', ...BM_CATS.map((c) => c.id), 'none'] as const).map((f) => {
              const n = f === 'all' ? bms.length : catStat[f]
              const cat = BM_CATS.find((c) => c.id === f)
              return (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={filter === f}
                  className={filter === f ? 'on' : ''}
                  onClick={() => onFilter(f)}
                  title={cat ? `${cat.name}（新加的书签会归到这类）` : undefined}
                >
                  {cat && <i style={{ background: cat.color }} />}
                  {f === 'all' ? '全部' : f === 'none' ? '未分类' : cat!.name}
                  <em>{n}</em>
                </button>
              )
            })}
          </div>
          {shown.length === 0 && <div className="reader-bm-empty">这一类下还没有书签</div>}
          {shown.map((b) => {
            const cat = BM_CATS.find((c) => c.id === b.cat)
            return (
              <div key={b.id} className="reader-bm-item">
                <button
                  className="reader-bm-cat"
                  onClick={() => onCycleCat(b.id)}
                  title={cat ? `${cat.name} · 点一下换分类` : '未分类 · 点一下设分类'}
                >
                  <i style={cat ? { background: cat.color } : undefined} />
                </button>
                <button className="reader-bm-go" onClick={() => onGo(b)}>
                  {b.label}
                </button>
                <button className="reader-bm-del" onClick={() => onDrop(b.id)} title="删除">
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
