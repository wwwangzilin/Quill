/**
 * 思维导图的布局引擎。
 *
 * 文档大纲 → 一棵树 → 按选定的呈现方式算出每个节点的坐标与连线的 path。
 * 六种布局共用同一份输出结构（nodes + links + bounds），所以渲染层只管画；
 * 换布局就是换一个算法，彼此互不干扰。
 *
 * 节点坐标一律是「左上角」，连线走 SVG 三次贝塞尔 —— 这两个约定让渲染层
 * 不需要知道自己在画哪一种布局。
 */
import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy'
import type { JSONContent } from '@tiptap/core'

export type MapLayout = 'logic' | 'logicLeft' | 'mind' | 'org' | 'outline' | 'fishbone'

export const LAYOUTS: { id: MapLayout; label: string; hint: string }[] = [
  { id: 'logic', label: '逻辑图', hint: '从左往右展开，最像大纲' },
  { id: 'logicLeft', label: '左向逻辑图', hint: '从右往左，适合放在右侧栏' },
  { id: 'mind', label: '思维导图', hint: '根在中间，左右分叉' },
  { id: 'org', label: '组织架构图', hint: '自上而下，层级一眼看清' },
  { id: 'outline', label: '紧凑大纲', hint: '缩进排版，不画线，信息密度最高' },
  { id: 'fishbone', label: '鱼骨图', hint: '主干加斜刺，适合找原因' },
]

export interface OutlineNode {
  id: string
  text: string
  children: OutlineNode[]
  /** 从 doc 根算起的 child index 链，用于点回正文定位、以及改写文档 */
  path: number[]
  /** 节点来源：标题 / 列表项 / 正文段落 */
  kind?: 'heading' | 'item' | 'para'
  /** 标题级别 1~6 */
  level?: number
}

const LIST_TYPES = ['bulletList', 'orderedList', 'taskList']

export function textOf(node: JSONContent | undefined): string {
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
    kind: 'item',
  }
  const marker = li.attrs?.checked === true ? '☑ ' : li.attrs?.checked === false ? '☐ ' : ''
  kids.forEach((k, i) => {
    if (!LIST_TYPES.includes(k.type ?? '')) return
    ;(k.content ?? []).forEach((sub, j) => {
      const child = liToNode(sub, `${id}-${i}-${j}`, [...path, i, j])
      if (marker && child.text !== '(空)') child.text = marker + child.text
      node.children.push(child)
    })
  })
  return node
}

/**
 * 把文档摊成一棵树。
 *
 * 按文档顺序走一遍：
 *   · 标题 → 按级别嵌套成分支
 *   · 列表 → 挂到当前标题下（列表项之间保持缩进层级）
 *   · 整篇既没标题也没列表时，才退回「段落平铺」的老办法
 * 每个节点都记着自己的物理 path，所以点节点照样能跳回正文。
 */
export function extractOutline(content: JSONContent | undefined, title: string): OutlineNode {
  const root: OutlineNode = { id: 'root', text: title || '未命名', children: [], path: [] }
  const nodes = content?.content ?? []
  const hasHeading = nodes.some((n) => n.type === 'heading')
  const hasList = nodes.some((n) => LIST_TYPES.includes(n.type ?? ''))

  // 纯段落文章：保持平铺（最多 24 条），至少还能看一眼结构
  if (!hasHeading && !hasList) {
    root.children = nodes
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => n.type === 'paragraph')
      .slice(0, 24)
      .map(({ n, i }) => ({
        id: `p${i}`,
        text: textOf(n).trim() || '(空)',
        children: [],
        path: [i],
        kind: 'para' as const,
      }))
    return root
  }

  /** 当前的挂载栈：标题级别越小越靠上 */
  const stack: { level: number; node: OutlineNode }[] = []
  const mount = () => (stack.length ? stack[stack.length - 1].node : root)

  nodes.forEach((n, i) => {
    if (n.type === 'heading') {
      const level = Math.min(6, Math.max(1, Number(n.attrs?.level ?? 1)))
      const node: OutlineNode = {
        id: `h${i}`,
        text: textOf(n).trim() || '(空标题)',
        children: [],
        path: [i],
        kind: 'heading',
        level,
      }
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
      mount().children.push(node)
      stack.push({ level, node })
      return
    }

    if (LIST_TYPES.includes(n.type ?? '')) {
      const items = (n.content ?? []).map((li, k) => liToNode(li, `n${i}-${k}`, [i, k]))
      mount().children.push(...items)
      return
    }

    // 段落：只在「这一节还没任何列表」时作为说明挂上去，免得导图被正文淹没
    if (n.type === 'paragraph') {
      const text = textOf(n).trim()
      if (!text) return
      const parent = mount()
      const alreadyHasItems = parent.children.some((c) => c.kind === 'item')
      if (alreadyHasItems || text.length > 60) return
      parent.children.push({
        id: `t${i}`,
        text,
        children: [],
        path: [i],
        kind: 'para',
      })
    }
  })

  return root
}

/* ---------------- 文本测量 ---------------- */

/** 节点框高度 */
export const NODE_H = 26
/** 兄弟节点之间的间距 */
const GAP_SIBLING = 38
/** 层级之间的间距 */
const GAP_DEPTH = 236

function charW(ch: string): number {
  return ch.charCodeAt(0) > 0x2e80 ? 13 : 7.2
}

export function boxWidth(text: string): number {
  let w = 0
  for (const ch of text) w += charW(ch)
  return Math.min(232, Math.max(68, w + 26))
}

export function fitText(text: string, width: number): string {
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

/* ---------------- 布局输出 ---------------- */

export interface MapNode {
  id: string
  text: string
  path: number[]
  kind: 'root' | 'heading' | 'item' | 'para'
  level?: number
  depth: number
  x: number
  y: number
  w: number
  h: number
  /** 鱼骨图里这一支朝上还是朝下，渲染层用来决定标签贴哪边 */
  side?: -1 | 1
}

export interface MapLink {
  id: string
  d: string
  depth: number
}

export interface MapResult {
  nodes: MapNode[]
  links: MapLink[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

function finish(nodes: MapNode[], links: MapLink[]): MapResult {
  if (!nodes.length) {
    return { nodes, links, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    if (n.x < minX) minX = n.x
    if (n.y < minY) minY = n.y
    if (n.x + n.w > maxX) maxX = n.x + n.w
    if (n.y + n.h > maxY) maxY = n.y + n.h
  }
  return { nodes, links, bounds: { minX, minY, maxX, maxY } }
}

function nodeOf(n: HierarchyPointNode<OutlineNode>, x: number, y: number): MapNode {
  const w = boxWidth(n.data.text)
  const kind = (n.depth === 0 ? 'root' : (n.data.kind ?? 'item')) as MapNode['kind']
  return {
    id: n.data.id,
    text: n.data.text,
    path: n.data.path,
    kind,
    level: n.data.level,
    depth: n.depth,
    x,
    y,
    w,
    h: NODE_H,
  }
}

const curve = (sx: number, sy: number, tx: number, ty: number, horizontal: boolean) => {
  if (horizontal) {
    const mx = (sx + tx) / 2
    return `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`
  }
  const my = (sy + ty) / 2
  return `M ${sx} ${sy} C ${sx} ${my}, ${tx} ${my}, ${tx} ${ty}`
}

/* ---------------- 逻辑图（两个方向） ---------------- */

function layoutLogic(outline: OutlineNode, dir: 1 | -1): MapResult {
  const root = tree<OutlineNode>().nodeSize([GAP_SIBLING, GAP_DEPTH])(hierarchy(outline))
  const nodes: MapNode[] = []
  const links: MapLink[] = []

  root.each((n) => {
    const w = boxWidth(n.data.text)
    nodes.push(nodeOf(n, dir > 0 ? n.y : -n.y - w, n.x - NODE_H / 2))
  })

  root.links().forEach((l, i) => {
    const pw = boxWidth(l.source.data.text)
    const cw = boxWidth(l.target.data.text)
    const sx = dir > 0 ? l.source.y + pw : -l.source.y
    const tx = dir > 0 ? l.target.y : -l.target.y - cw
    links.push({ id: `l${i}`, d: curve(sx, l.source.x, tx, l.target.x, true), depth: l.source.depth })
  })

  return finish(nodes, links)
}

/* ---------------- 组织架构图（自上而下） ---------------- */

function layoutOrg(outline: OutlineNode): MapResult {
  // 上下布局时兄弟是横向排的，间距得留得下最宽的框，所以用固定值
  const root = tree<OutlineNode>().nodeSize([150, 96])(hierarchy(outline))
  const nodes: MapNode[] = []
  const links: MapLink[] = []

  root.each((n) => {
    const w = boxWidth(n.data.text)
    nodes.push(nodeOf(n, n.x - w / 2, n.y))
  })

  root.links().forEach((l, i) => {
    links.push({
      id: `l${i}`,
      d: curve(l.source.x, l.source.y + NODE_H, l.target.x, l.target.y, false),
      depth: l.source.depth,
    })
  })

  return finish(nodes, links)
}

/* ---------------- 思维导图（中心向两侧） ---------------- */

function layoutMind(outline: OutlineNode): MapResult {
  const kids = outline.children
  // 一个孩子都没有就没什么可辐射的，退回逻辑图更实在；
  // 只有一个也照样放右侧 —— 根仍然居中，视觉上依旧是导图
  if (!kids.length) return layoutLogic(outline, 1)

  const rootW = boxWidth(outline.text)
  const nodes: MapNode[] = []
  const links: MapLink[] = []

  // 根居中，中心落在原点
  nodes.push({
    id: outline.id,
    text: outline.text,
    path: outline.path,
    kind: 'root',
    depth: 0,
    x: -rootW / 2,
    y: -NODE_H / 2,
    w: rootW,
    h: NODE_H,
  })

  // 一半往右、一半往左；两边各算一棵树，虚拟根就是真的根
  const half = Math.ceil(kids.length / 2)
  const sides: { list: OutlineNode[]; dir: 1 | -1 }[] = [
    { list: kids.slice(0, half), dir: 1 },
    { list: kids.slice(half), dir: -1 },
  ]
  const GAP_ROOT = 62

  sides.forEach(({ list, dir }, si) => {
    if (!list.length) return
    const sub = tree<OutlineNode>().nodeSize([GAP_SIBLING, GAP_DEPTH])(
      hierarchy({ ...outline, children: list }),
    )
    const offset = dir > 0 ? rootW / 2 + GAP_ROOT : -rootW / 2 - GAP_ROOT

    sub.each((n) => {
      if (n.depth === 0) return // 虚拟根不画，真根已经放过了
      const w = boxWidth(n.data.text)
      const away = n.y - GAP_DEPTH
      const x = dir > 0 ? offset + away : offset - away - w
      nodes.push(nodeOf(n, x, n.x - NODE_H / 2))
    })

    sub.links().forEach((l, i) => {
      const goingRight = dir > 0
      const pw = boxWidth(l.source.data.text)
      const cw = boxWidth(l.target.data.text)
      // 第一层从真实根的边缘出发（虚拟根不画，但连线得接上）
      const fx =
        l.source.depth === 0
          ? goingRight
            ? rootW / 2
            : -rootW / 2
          : goingRight
            ? l.source.y + pw
            : -l.source.y
      const fy = l.source.depth === 0 ? 0 : l.source.x
      const tx = goingRight
        ? offset + (l.target.y - GAP_DEPTH)
        : offset - (l.target.y - GAP_DEPTH) - cw
      links.push({
        id: `m${si}-${i}`,
        d: curve(fx, fy, tx, l.target.x, true),
        depth: l.source.depth,
      })
    })
  })

  return finish(nodes, links)
}

/* ---------------- 紧凑大纲（缩进排版，不画线） ---------------- */

function layoutOutline(outline: OutlineNode): MapResult {
  const nodes: MapNode[] = []
  const INDENT = 26
  const LINE_H = NODE_H + 8
  let row = 0

  const walk = (n: OutlineNode, depth: number) => {
    const w = boxWidth(n.text)
    nodes.push({
      id: n.id,
      text: n.text,
      path: n.path,
      kind: depth === 0 ? 'root' : (n.kind ?? 'item'),
      level: n.level,
      depth,
      x: depth * INDENT,
      y: row * LINE_H,
      w,
      h: NODE_H,
    })
    row += 1
    n.children.forEach((c) => walk(c, depth + 1))
  }
  walk(outline, 0)

  return finish(nodes, [])
}

/* ---------------- 鱼骨图 ---------------- */

function layoutFishbone(outline: OutlineNode): MapResult {
  const nodes: MapNode[] = []
  const links: MapLink[] = []
  const rootW = boxWidth(outline.text)

  // 鱼头在右，主干向左延伸
  nodes.push({
    id: outline.id,
    text: outline.text,
    path: outline.path,
    kind: 'root',
    depth: 0,
    x: 0,
    y: -NODE_H / 2,
    w: rootW,
    h: NODE_H,
  })

  const kids = outline.children
  const STEM_GAP = 168
  const SPUR_X = 150
  const SPUR_Y = 92
  const stemLen = Math.max(120, kids.length * STEM_GAP + 60)
  links.push({ id: 'stem', d: `M ${-stemLen} 0 L ${-rootW / 2} 0`, depth: 0 })

  kids.forEach((kid, i) => {
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1
    const bx = -90 - i * STEM_GAP
    const tipX = bx - SPUR_X
    const tipY = side * SPUR_Y

    links.push({ id: `sp${i}`, d: `M ${bx} 0 L ${tipX} ${tipY}`, depth: 1 })

    const w = boxWidth(kid.text)
    nodes.push({
      id: kid.id,
      text: kid.text,
      path: kid.path,
      kind: kid.kind ?? 'item',
      level: kid.level,
      depth: 1,
      x: tipX - w / 2,
      y: tipY - NODE_H / 2,
      w,
      h: NODE_H,
      side,
    })

    // 二级及更深：沿刺的延长线一路排下去，不能只画两层 —— 那样深层节点全丢
    const place = (
      list: OutlineNode[],
      fromX: number,
      fromY: number,
      depth: number,
      branch: string,
      scale: number,
    ) => {
      list.forEach((sub, j) => {
        const sw = boxWidth(sub.text)
        const step = 0.6 * scale
        const px = fromX - SPUR_X * step * (1 + j * 0.9)
        const py = fromY + side * SPUR_Y * step * (1 + j * 0.9)
        links.push({ id: `ss${branch}-${j}`, d: `M ${fromX} ${fromY} L ${px} ${py}`, depth })
        nodes.push({
          id: sub.id,
          text: sub.text,
          path: sub.path,
          kind: sub.kind ?? 'item',
          level: sub.level,
          depth,
          x: px - sw / 2,
          y: py - NODE_H / 2,
          w: sw,
          h: NODE_H,
          side,
        })
        if (sub.children.length) place(sub.children, px, py, depth + 1, `${branch}-${j}`, scale * 0.72)
      })
    }
    place(kid.children, tipX, tipY, 2, String(i), 1)
  })

  return finish(nodes, links)
}

/* ---------------- 入口 ---------------- */

export function computeMap(outline: OutlineNode, layout: MapLayout): MapResult {
  switch (layout) {
    case 'logicLeft':
      return layoutLogic(outline, -1)
    case 'org':
      return layoutOrg(outline)
    case 'mind':
      return layoutMind(outline)
    case 'outline':
      return layoutOutline(outline)
    case 'fishbone':
      return layoutFishbone(outline)
    case 'logic':
    default:
      return layoutLogic(outline, 1)
  }
}
