import { useEffect, useMemo, useRef, useState } from 'react'
import { hierarchy, tree } from 'd3-hierarchy'
import type { JSONContent } from '@tiptap/core'
import { toast } from './toast'

interface OutlineNode {
  id: string
  text: string
  children: OutlineNode[]
  /** 从 doc 根算起的 child index 链，用于点回正文定位 */
  path: number[]
}

const PAD_X = 76
const PAD_Y = 44
const V_GAP = 38
const H_GAP = 236

function textOf(node: JSONContent | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(textOf).join('')
}

function liToNode(li: JSONContent, id: string, path: number[]): OutlineNode {
  const kids = li.content ?? []
  const head = kids.find((k) => k.type === 'paragraph' || k.type === 'heading')
  const node: OutlineNode = {
    id,
    text: textOf(head).trim() || '(空)',
    children: [],
    path,
  }
  const marker = li.attrs?.checked === true ? '☑ ' : li.attrs?.checked === false ? '☐ ' : ''
  kids.forEach((k, i) => {
    if (k.type !== 'bulletList' && k.type !== 'orderedList' && k.type !== 'taskList') return
    ;(k.content ?? []).forEach((sub, j) => {
      const child = liToNode(sub, `${id}-${i}-${j}`, [...path, i, j])
      if (marker && child.text !== '(空)') child.text = marker + child.text
      node.children.push(child)
    })
  })
  return node
}

function extractOutline(content: JSONContent | undefined, title: string): OutlineNode {
  const root: OutlineNode = { id: 'root', text: title || '未命名', children: [], path: [] }
  const nodes = content?.content ?? []
  const listIdx = nodes.findIndex(
    (n) => n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'taskList',
  )
  if (listIdx >= 0) {
    root.children = (nodes[listIdx].content ?? []).map((li, i) =>
      liToNode(li, `n${i}`, [listIdx, i]),
    )
  } else {
    root.children = nodes
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => n.type === 'paragraph' || n.type === 'heading')
      .slice(0, 24)
      .map(({ n, i }) => ({
        id: `p${i}`,
        text: textOf(n).trim() || '(空)',
        children: [],
        path: [i],
      }))
  }
  return root
}

function charW(ch: string): number {
  return ch.charCodeAt(0) > 0x2e80 ? 13 : 7.2
}

function boxWidth(text: string): number {
  let w = 0
  for (const ch of text) w += charW(ch)
  return Math.min(232, Math.max(68, w + 26))
}

function fitText(text: string, width: number): string {
  const max = width - 24
  let acc = 0
  let out = ''
  for (const ch of text) {
    const w = charW(ch)
    if (acc + w > max) return out + '…'
    acc += w
    out += ch
  }
  return out
}

interface Props {
  content: JSONContent | undefined
  title: string
  onJump?: (path: number[]) => void
}

export default function MindMap({ content, title, onJump }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState({ x: PAD_X, y: 0, k: 1 })
  const fittedRef = useRef(false)
  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const apply = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const layout = useMemo(() => {
    const outline = extractOutline(content, title)
    // tree() 原地写入 x/y 并返回 HierarchyPointNode，坐标类型才是 number
    const root = tree<OutlineNode>().nodeSize([V_GAP, H_GAP])(hierarchy(outline))
    const nodes = root.descendants()
    const links = root.links()
    const min = nodes.length ? Math.min(...nodes.map((n) => n.x)) : 0
    const max = nodes.length ? Math.max(...nodes.map((n) => n.x)) : 0
    const depth = nodes.length ? Math.max(...nodes.map((n) => n.y)) : 0
    return { nodes, links, min, max, depth }
  }, [content, title])

  // 首次布局完成后自动适配大小并垂直居中
  useEffect(() => {
    if (fittedRef.current) return
    if (!size.h || !layout.nodes.length) return
    fittedRef.current = true
    const contentH = layout.max - layout.min
    const k = Math.min(1.05, Math.max(0.4, (size.h - PAD_Y * 2) / Math.max(contentH, V_GAP)))
    setView({
      x: PAD_X,
      y: size.h / 2 - ((layout.min + layout.max) / 2) * k,
      k,
    })
  }, [layout, size.h])

  // 滚轮缩放（跟随鼠标），需要 passive:false 才能 preventDefault
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
        const k = Math.min(2.6, Math.max(0.28, v.k * factor))
        const ratio = k / v.k
        return { k, x: mx - (mx - v.x) * ratio, y: my - (my - v.y) * ratio }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) }))
    }
    const up = () => {
      dragRef.current = null
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  const empty = layout.nodes.length <= 1

  /** 把 SVG 连同内联样式一起导出 —— 外层 CSS 不会跟着序列化，必须自己塞进去 */
  const exportImage = async (format: 'png' | 'svg') => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', String(Math.round(rect.width)))
    clone.setAttribute('height', String(Math.round(rect.height)))

    const dark = document.documentElement.dataset.theme !== 'light'
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = `
      .mm-node text { font-family: "HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",sans-serif; font-size: 12.5px; fill: ${dark ? '#e8e4dc' : '#221f1b'}; }
      .mm-node .box { fill: ${dark ? '#171614' : '#fffdf9'}; stroke: ${dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.18)'}; stroke-width: 1; }
      .mm-node.root .box { stroke: #cba56b; stroke-width: 1.6; }
      .mm-link { fill: none; stroke: ${dark ? 'rgba(180,170,155,0.4)' : 'rgba(120,112,100,0.5)'}; stroke-width: 1.4; stroke-dasharray: none !important; stroke-dashoffset: 0 !important; }
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

  return (
    <div className="mindmap" ref={wrapRef}>
      <svg
        ref={svgRef}
        onMouseDown={(e) => {
          dragRef.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
        }}
      >
        <defs>
          <linearGradient id="mm-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#d3ae74" />
            <stop offset="100%" stopColor="#a8843f" />
            
          </linearGradient>
        </defs>
        <g transform={`translate(${view.x}, ${view.y}) scale(${view.k})`}>
          {layout.links.map((l, i) => {
            const sx = l.source.y + boxWidth(l.source.data.text)
            const sy = l.source.x
            const tx = l.target.y
            const ty = l.target.x
            const mx = (sx + tx) / 2
            return (
              <path
                key={`l${i}`}
                className={'mm-link' + (l.source.depth === 0 ? ' root' : '')}
                d={`M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`}
                pathLength={1}
              />
            )
          })}

          {layout.nodes.map((n) => {
            const w = boxWidth(n.data.text)
            return (
              <g
                key={n.data.id}
                className={'mm-node' + (n.depth === 0 ? ' root' : '')}
                transform={`translate(${n.y}, ${n.x})`}
                onClick={() => {
                  if (n.data.path.length && onJump) onJump(n.data.path)
                }}
              >
                <rect className="box" x={0} y={-13} width={w} height={26} rx={8} />
                <text x={12} y={0}>
                  {fitText(n.data.text, w)}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
      {!empty && (
        <div className="mm-tools">
          <button className="btn" onClick={() => void exportImage('png')} title="导出为 PNG（2 倍图）">
            导出 PNG
          </button>
          <button className="btn" onClick={() => void exportImage('svg')} title="导出为矢量 SVG">
            导出 SVG
          </button>
        </div>
      )}
      {empty ? (
        <div className="mm-hint">还没有大纲结构 —— 回写作页，用 - 加空格开始列条目</div>
      ) : (
        <div className="mm-hint">
          {layout.nodes.length - 1} 个分支 · 滚轮缩放 · 拖动平移
        </div>
      )}
    </div>
  )
}
