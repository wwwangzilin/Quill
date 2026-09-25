import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor, JSONContent } from '@tiptap/core'
import {
  computeMap,
  extractOutline,
  fitText,
  LAYOUTS,
  type MapLayout,
} from '../core/mindmap'
import { addChild, deleteNode, moveNode, renameNode } from '../core/mindmapEdit'
import { isDarkTheme } from '../core/theme'
import { toast } from './toast'

const LAYOUT_KEY = 'quill-map-layout'
const PAD = 60

interface Props {
  content: JSONContent | undefined
  title: string
  /** 点节点跳回正文 */
  onJump?: (path: number[]) => void
  /** 传了才可编辑；不传就是纯只读视图 */
  editor?: Editor | null
}

function readLayout(): MapLayout {
  try {
    const v = localStorage.getItem(LAYOUT_KEY)
    if (v && LAYOUTS.some((l) => l.id === v)) return v as MapLayout
  } catch {
    /* 读不到就用默认 */
  }
  return 'logic'
}

/**
 * 思维导图。
 *
 * 视图这一层只做三件事：把布局引擎算好的坐标画出来、把鼠标键盘的意图翻译成
 * 「改哪个节点、怎么改」、把意图交给 mindmapEdit 落到文档上。
 * 它自己**不持有大纲数据** —— 唯一的真相源永远是文档。
 */
export default function MindMap({ content, title, onJump, editor }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [layout, setLayout] = useState<MapLayout>(readLayout)
  const [live, setLive] = useState<JSONContent | undefined>(content)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; path: number[]; value: string } | null>(null)
  const [dragPath, setDragPath] = useState<number[] | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const fittedRef = useRef('')
  const panRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const movedRef = useRef(false)

  const editable = Boolean(editor)

  /* ---------- 数据 ---------- */

  /**
   * 内容从哪来：有编辑器就以它为准 —— 文档是唯一真相源，编辑完能立刻反映，
   * 不用等外层那次 1.4 秒的防抖保存。没有编辑器（只读场景）才用传进来的快照。
   */
  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      setLive(content)
      return
    }
    setLive(editor.getJSON())
    const onUpdate = () => setLive(editor.getJSON())
    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
    }
  }, [editor, content])

  const outline = useMemo(() => extractOutline(live, title), [live, title])
  const map = useMemo(() => computeMap(outline, layout), [outline, layout])

  /* ---------- 尺寸与自动适配 ---------- */

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const apply = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 换了布局、换了文档就重新适配一次；之后交给用户自己缩放
  const fitKey = `${layout}|${title}|${map.nodes.length}`
  useEffect(() => {
    if (!size.w || !size.h || !map.nodes.length) return
    if (fittedRef.current === fitKey) return
    fittedRef.current = fitKey
    const b = map.bounds
    const w = Math.max(b.maxX - b.minX, 1)
    const h = Math.max(b.maxY - b.minY, 1)
    const k = Math.min(1.05, Math.max(0.3, Math.min((size.w - PAD * 2) / w, (size.h - PAD * 2) / h)))
    setView({
      x: (size.w - w * k) / 2 - b.minX * k,
      y: (size.h - h * k) / 2 - b.minY * k,
      k,
    })
  }, [fitKey, size.w, size.h, map])

  /* ---------- 缩放与平移 ---------- */

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = Math.exp(-e.deltaY * 0.0015)
      setView((v) => {
        const k = Math.min(2.6, Math.max(0.2, v.k * factor))
        const ratio = k / v.k
        return { k, x: mx - (mx - v.x) * ratio, y: my - (my - v.y) * ratio }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = panRef.current
      if (!d) return
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) movedRef.current = true
      setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) }))
    }
    const up = () => {
      panRef.current = null
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  /* ---------- 编辑 ---------- */

  const commitEdit = useCallback(() => {
    if (!editing) return
    const { path, value, id } = editing
    setEditing(null)
    if (!editor) return
    const node = map.nodes.find((n) => n.id === id)
    if (node && node.text === value.trim()) return
    if (renameNode(editor, path, value)) {
      setSelected(null)
    } else {
      toast.error('改不了这个名字', '这一块可能不是标题或条目')
    }
  }, [editing, editor, map.nodes])

  const doAddChild = useCallback(() => {
    if (!editor || !selected) return
    const node = map.nodes.find((n) => n.id === selected)
    if (!node) return
    const next = addChild(editor, node.path)
    if (!next) {
      toast.error('这里加不了子节点', '标题、段落和条目下面才可以加')
      return
    }
    setEditing({ id: '', path: next, value: '' })
    setSelected(null)
  }, [editor, selected, map.nodes])

  const doDelete = useCallback(() => {
    if (!editor || !selected) return
    const node = map.nodes.find((n) => n.id === selected)
    if (!node) return
    if (!node.path.length) {
      toast.info('根节点删不掉', '它就是这篇文档的标题')
      return
    }
    if (deleteNode(editor, node.path)) {
      setSelected(null)
      toast.success('已删除', 'Ctrl+Z 可以撤销')
    }
  }, [editor, selected, map.nodes])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editing) return // 编辑框自己处理按键
      if (!editable) return
      if (e.key === 'Tab') {
        e.preventDefault()
        doAddChild()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        doDelete()
      } else if (e.key === 'Enter' && selected) {
        e.preventDefault()
        const node = map.nodes.find((n) => n.id === selected)
        if (node?.path.length && onJump) onJump(node.path)
      } else if (e.key === 'Escape') {
        setSelected(null)
      }
    },
    [editing, editable, doAddChild, doDelete, selected, map.nodes, onJump],
  )

  /* ---------- 拖动调层级 ---------- */

  const pickNodeAt = (clientX: number, clientY: number): string | null => {
    const el = wrapRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const px = (clientX - rect.left - view.x) / view.k
    const py = (clientY - rect.top - view.y) / view.k
    for (const n of map.nodes) {
      if (px >= n.x && px <= n.x + n.w && py >= n.y && py <= n.y + n.h) return n.id
    }
    return null
  }

  const onNodePointerDown = (e: React.PointerEvent, n: (typeof map.nodes)[number]) => {
    if (!editable) return
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const path = n.path
    let dragging = false

    const move = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 6) {
        dragging = true
        setDragPath(path)
      }
      if (dragging) setHoverId(pickNodeAt(ev.clientX, ev.clientY))
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragPath(null)
      const hit = pickNodeAt(ev.clientX, ev.clientY)
      setHoverId(null)
      if (dragging) {
        if (hit && hit !== n.id) {
          const target = map.nodes.find((x) => x.id === hit)
          if (target && editor && moveNode(editor, path, target.path)) {
            toast.success('已移动', `挂到「${target.text}」下面 · Ctrl+Z 可撤销`)
            setSelected(null)
          } else {
            toast.error('移不过去', '不能把节点拖进它自己的子节点里')
          }
        }
      } else {
        setSelected(n.id)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* ---------- 导出 ---------- */

  const exportImage = async (format: 'png' | 'svg') => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', String(Math.round(rect.width)))
    clone.setAttribute('height', String(Math.round(rect.height)))
    // 编辑框是 HTML，不进导出
    clone.querySelectorAll('.mm-edit').forEach((el) => el.remove())

    // 用主题自己声明的深浅，别去猜 dataset 的值 —— 现在不止暗/亮两套了
    const dark = isDarkTheme()
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = `
      .mm-node text { font-family: "HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",sans-serif; font-size: 12.5px; fill: ${dark ? '#e8e4dc' : '#221f1b'}; }
      .mm-node .box { fill: ${dark ? '#171614' : '#fffdf9'}; stroke: ${dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.18)'}; stroke-width: 1; }
      .mm-node.root .box { stroke: #cba56b; stroke-width: 1.6; }
      .mm-node.sel .box { stroke: #cba56b; stroke-width: 1.8; }
      .mm-link { fill: none; stroke: ${dark ? 'rgba(180,170,155,0.4)' : 'rgba(120,112,100,0.5)'}; stroke-width: 1.4; }
      .mm-node rect, .mm-node text { opacity: 1 !important; animation: none !important; }
    `
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bg.setAttribute('x', '0')
    bg.setAttribute('y', '0')
    bg.setAttribute('width', '100%')
    bg.setAttribute('height', '100%')
    bg.setAttribute('fill', dark ? '#0f0e0d' : '#faf7f2')
    clone.insertBefore(style, clone.firstChild)
    clone.insertBefore(bg, clone.firstChild)

    const xml = new XMLSerializer().serializeToString(clone)
    const safe = title.trim().replace(/[\\/:*?"<>|]/g, '_') || '导图'

    if (format === 'svg') {
      const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = `${safe}.svg`
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(href), 2000)
      toast.success('已导出 SVG', `${safe}.svg`)
      return
    }

    try {
      const img = new Image()
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('SVG 转图片失败'))
        img.src = url
      })
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(rect.width * scale)
      canvas.height = Math.round(rect.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = `${safe}.png`
      a.click()
      toast.success('已导出 PNG', `${safe}.png @2x`)
    } catch (err) {
      toast.error('导出失败', String(err))
    }
  }

  const empty = map.nodes.length <= 1
  const editingNode = editing ? map.nodes.find((n) => n.id === editing.id) : null
  // 新增节点时还没有 id，用路径反查它落在哪
  const editingPos =
    editing && !editingNode
      ? map.nodes.find((n) => n.path.join() === editing.path.join())
      : editingNode

  return (
    <div className="mindmap" ref={wrapRef} tabIndex={0} onKeyDown={onKeyDown}>
      <svg
        ref={svgRef}
        onMouseDown={(e) => {
          movedRef.current = false
          panRef.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
        }}
        onClick={() => {
          if (!movedRef.current) setSelected(null)
        }}
      >
        <g transform={`translate(${view.x}, ${view.y}) scale(${view.k})`}>
          {map.links.map((l) => (
            <path
              key={l.id}
              className={'mm-link' + (l.depth === 0 ? ' root' : '')}
              d={l.d}
              pathLength={1}
            />
          ))}

          {map.nodes.map((n) => {
            const cls =
              'mm-node' +
              (n.kind === 'root' ? ' root' : '') +
              (n.kind === 'heading' ? ` heading lv${n.level ?? 1}` : '') +
              (n.kind === 'para' ? ' para' : '') +
              (selected === n.id ? ' sel' : '') +
              (dragPath && dragPath.join() === n.path.join() ? ' dragging' : '') +
              (hoverId === n.id ? ' droptarget' : '') +
              (layout === 'outline' ? ' flat' : '')
            return (
              <g
                key={n.id || n.path.join('-')}
                className={cls}
                transform={`translate(${n.x}, ${n.y})`}
                onPointerDown={(e) => onNodePointerDown(e, n)}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  if (editable) setEditing({ id: n.id, path: n.path, value: n.text })
                }}
              >
                <rect className="box" x={0} y={0} width={n.w} height={n.h} rx={8} />
                <text x={12} y={n.h / 2}>
                  {fitText(n.text, n.w)}
                </text>
              </g>
            )
          })}
        </g>
      </svg>

      {/* 改名输入框浮在节点上（HTML 层，不进导出） */}
      {editing && editingPos && (
        <input
          className="mm-edit"
          autoFocus
          spellCheck={false}
          value={editing.value}
          placeholder={editing.value ? '' : '写点什么…'}
          style={{
            left: `${editingPos.x * view.k + view.x}px`,
            top: `${editingPos.y * view.k + view.y}px`,
            width: `${Math.max(110, editingPos.w * view.k)}px`,
            height: `${Math.max(24, editingPos.h * view.k)}px`,
            fontSize: `${Math.max(11, 12.5 * view.k)}px`,
          }}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              e.preventDefault()
              commitEdit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(null)
            }
          }}
        />
      )}

      <div className="mm-tools">
        <div className="mm-layouts">
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              className={'mm-lay' + (l.id === layout ? ' on' : '')}
              title={l.hint}
              onClick={() => {
                setLayout(l.id)
                try {
                  localStorage.setItem(LAYOUT_KEY, l.id)
                } catch {
                  /* 存不进去只是记不住偏好 */
                }
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
        {!empty && (
          <>
            <span className="grow" />
            <button className="btn" onClick={() => void exportImage('png')} title="导出为 PNG · 2 倍图">
              导出 PNG
            </button>
            <button className="btn" onClick={() => void exportImage('svg')} title="导出为矢量 SVG">
              导出 SVG
            </button>
          </>
        )}
      </div>

      <div className="mm-hint">
        {empty ? (
          '还没有大纲结构 —— 回写作页，用 - 加空格开始列条目'
        ) : editable ? (
          <>
            {map.nodes.length - 1} 个分支 · 双击改字 · Tab 加子节点 · Delete 删 · 拖动调层级 · 回车跳正文
          </>
        ) : (
          `${map.nodes.length - 1} 个分支 · 滚轮缩放 · 拖动平移`
        )}
      </div>
    </div>
  )
}
