import MoreMenu, { type MenuItem } from '../ui/MoreMenu'
import WindowControls from '../ui/WindowControls'
import { openQuickNote } from '../core/windows'
import { storage } from '../core/storage'
import type { ViewMode } from '../core/types'

interface Props {
  asideShown: boolean
  onToggleAside: () => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
  vaultMode: boolean
  vaultLabel: string
  view: ViewMode
  onSwitchView: (v: ViewMode) => void
  hasDoc: boolean
  onPin: () => Promise<void>
  moreItems: MenuItem[]
}

/** 顶部标题栏：开关、品牌、视图切换、便签与「更多」菜单、窗口按钮 */
export default function TitleBar({
  asideShown,
  onToggleAside,
  sidebarOpen,
  onToggleSidebar,
  vaultMode,
  vaultLabel,
  view,
  onSwitchView,
  hasDoc,
  onPin,
  moreItems,
}: Props) {
  return (
    <div className="titlebar" data-tauri-drag-region>
    {/* 顶栏藏起来之后留在顶部的那两块感应区。
        右上角是主入口（窗口按钮就在那儿）；顶上那条 6px 细边是备用通道 ——
        无边框窗口只能拖标题栏，没有它就没法用鼠标搬动窗口。
        特别注意：细边只认「按下去」，鼠标扫过不算 ——
        不然手从正文往上划一下就闪一条顶栏出来。 */}
    {/*
      顶栏不再有自己的「热区」那一套了。
      以前它平时藏着、要鼠标够到上沿才滑出来，于是在它上面的按钮永远点不到
      （滑出来的过程中按钮在往下走，鼠标追过去就掉出热区，来回抖）。
      现在上/下/左三个栏共用一套：**鼠标一动就出来，敲字才收**（见 barsHidden）。
    */}
      {/* 右侧栏开关。它和左栏的 ☰ 是一对：左边是「哪些文档」，右边是「长什么样」 */}
      <button
        className={'btn ghost icon' + (asideShown ? ' on' : '')}
        onClick={() => {
          /*
           * 只翻这一会儿的状态，**不往 localStorage 记**。
           * 记了的话：点一次 ✕，以后每次打开都见不到右栏，还以为功能没了
           * （主人报过「右栏怎么没有自动展开」）。
           * 也别把副作用塞进 setState 的 updater —— StrictMode 会把 updater
           * 跑两遍，第二遍拿到的已经是最新值，翻回去等于没点。
           */
          onToggleAside()
        }}
        title={asideShown ? '收起外观栏' : '展开外观栏 · 主题、字体、排版'}
      >
        🎛
      </button>
      <button
        className="btn ghost icon"
        onClick={() => onToggleSidebar()}
        title={sidebarOpen ? '收起侧栏' : '展开侧栏'}
      >
        ☰
      </button>
      <div className="brand" data-tauri-drag-region>
        <span className="mark" />
        Quill
      </div>
      {vaultMode && (
        <button
          className="btn ghost icon"
          title={`文档仓库：${vaultLabel} · 点击打开文件夹`}
          onClick={() => void storage.reveal()}
        >
          🗀
        </button>
      )}
      <div className="grow" data-tauri-drag-region />
      <div className="seg">
        <button className={view === 'write' ? 'on' : ''} onClick={() => onSwitchView('write')}>
          写作
        </button>
        <button className={view === 'mindmap' ? 'on' : ''} onClick={() => onSwitchView('mindmap')}>
          导图
        </button>
      </div>
      <button
        className="btn ghost icon"
        onClick={() => void openQuickNote()}
        title="快捷便签 · Ctrl+Space"
      >
        ✎
      </button>
      <button
        className="btn ghost icon"
        onClick={() => void onPin()}
        title="钉到桌面"
        disabled={!hasDoc}
      >
        📌
      </button>
      {/*
        右侧栏开关摆在**右上角**，不是左上角。
        左上角那块只有 12px 高的热区：顶栏一展开按钮就跟着往下走，
        鼠标追过去就掉出热区、顶栏又收回去 —— 来回追，永远点不到。
        右上角这边有一块 300×46 的常驻热区（窗口按钮一直靠它），
        摆在这儿就跟窗口按钮一样，够得着、点得中。
      */}
      <MoreMenu items={moreItems} title="更多操作" />
      <WindowControls />
    </div>
  )
}
