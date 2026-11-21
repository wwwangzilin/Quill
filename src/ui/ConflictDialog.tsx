import { useEffect, useMemo, useRef } from 'react'
import type { ConflictInfo } from '../core/docGuard'
import { lineDiff, type DiffRow } from '../core/lineDiff'

/**
 * 外部改动冲突的对比框。
 *
 * 存在的理由只有一个：**不能默默覆盖**。用户在 VS Code / Obsidian / 同步盘里
 * 改过同一篇，Quill 的自动保存如果照旧整篇写下去，外面的改动就没了 ——
 * 而 git 历史里只会多一条「更新《…》」，事后连想找都找不回来。
 *
 * 所以这里的按钮都写成人话，代价也直接写在按钮下面。
 */

interface Props {
  info: ConflictInfo
  /** 用我的版本覆盖磁盘 */
  onKeepMine: () => void
  /** 丢掉我的未保存改动，载入磁盘版本 */
  onTakeDisk: () => void
  /** 把磁盘版本接到文末，之后按我的版本保存 */
  onMerge: () => void
  /** 自动合并（只在两边改的是不同段落时出现） */
  onAutoMerge?: () => void
  /** 外部改名：换成新文件名继续写 */
  onAdoptRename: () => void
  /** 另存为一篇新文档 */
  onSaveAsNew: () => void
  /** 打开历史抽屉，从 git 里找回 */
  onRestoreHistory: () => void
  /** 先放着（保持暂停保存） */
  onLater: () => void
}

export default function ConflictDialog({
  info,
  onKeepMine,
  onTakeDisk,
  onMerge,
  onAutoMerge,
  onAdoptRename,
  onSaveAsNew,
  onRestoreHistory,
  onLater,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(
    () => (info.disk == null ? [] : lineDiff(info.mine, info.disk)),
    [info.mine, info.disk],
  )

  // 弹窗一出来就把焦点收进来：Escape 只走「稍后处理」，不会误触别的操作
  useEffect(() => {
    boxRef.current?.focus()
  }, [])

  const deleted = info.code === 'deleted'

  return (
    <div className="conflict-mask" role="dialog" aria-modal="true">
      <div
        className="conflict"
        ref={boxRef}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onLater()
        }}
      >
        <header className="conflict-head">
          <span className="conflict-icon">{deleted ? '✕' : '⚠'}</span>
          <div>
            <h3>
              {deleted ? '这篇文档在外部被删除或改名了' : '这篇文档在外部被改过了'}
            </h3>
            <p>
              {deleted
                ? '磁盘上已经没有这个文件。继续按原来的路径保存，等于在仓库里凭空造一个同名的新文档。'
                : '磁盘上的内容和你打开时不再一致。直接保存会把外面的改动整段盖掉，先看一眼再决定。'}
            </p>
          </div>
        </header>

        {deleted ? (
          <div className="conflict-empty">
            <p>
              <code>{info.docId}</code> 不在仓库里了。
            </p>
            {info.renamedTo && (
              <p className="conflict-rename">
                不过找到一篇内容完全一样的：<code>{info.renamedTo}</code>
                ——多半是被外部重命名了。
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="conflict-legend">
              <span className="lg mine">− 我的未保存版本</span>
              <span className="lg disk">+ 磁盘上的版本</span>
            </div>
            <pre className="conflict-diff">
              {rows.map((r, i) => (
                <div key={i} className={`dl ${r.kind}`}>
                  <span className="dl-mark">
                    {r.kind === 'mine' ? '−' : r.kind === 'disk' ? '+' : ' '}
                  </span>
                  <span className="dl-text">{r.text || ' '}</span>
                </div>
              ))}
            </pre>
          </>
        )}

        <footer className="conflict-foot">
          {deleted ? (
            <>
              {info.renamedTo && (
                <button className="btn primary" onClick={onAdoptRename}>
                  跟随改名，继续写
                </button>
              )}
              <button className={'btn' + (info.renamedTo ? '' : ' primary')} onClick={onSaveAsNew}>
                另存为一篇新文档
              </button>
              <button className="btn ghost" onClick={onRestoreHistory}>
                从 git 历史恢复
              </button>
            </>
          ) : (
            <>
              {info.merge && info.merge.conflicts === 0 && onAutoMerge && (
                <button className="btn primary" onClick={onAutoMerge}>
                  自动合并并保存
                </button>
              )}
              <button
                className={'btn' + (info.merge && info.merge.conflicts === 0 ? '' : ' primary')}
                onClick={onKeepMine}
              >
                保存我的版本
              </button>
              <button className="btn" onClick={onTakeDisk}>
                采用磁盘版本
              </button>
              <button className="btn" onClick={onMerge}>
                磁盘版本接到文末
              </button>
            </>
          )}
          <span className="grow" />
          <button className="btn ghost" onClick={onLater} title="先不处理，自动保存会一直暂停">
            稍后处理
          </button>
        </footer>
        <p className="conflict-hint">
          {deleted
            ? '选「稍后处理」不会丢内容：这篇会一直暂停保存，状态栏会挂一条提示。'
            : info.merge
              ? info.merge.conflicts === 0
                ? '两边改的是不同段落，可以自动合上；合出来的结果会先过一遍检查再落盘。'
                : `有 ${info.merge.conflicts} 处改到了同一段，需要你自己定：可以「接到文末」两份都留，或选一边。`
              : '「接到文末」会把两份都留下（以你的版本为主），适合两边都有想保留的段落。'}
        </p>
      </div>
    </div>
  )
}
