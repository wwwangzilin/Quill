/**
 * 思维导图的编辑操作。
 *
 * 关键约定：**导图不改自己的数据**。所有编辑都翻译成 ProseMirror 事务落到文档上，
 * 于是撤销栈、自动保存、git 历史、`.md` 文件全都照旧有效 —— 导图只是文档的另一个视图。
 *
 * 节点定位靠 path（从 doc 根算起的 child index 链），和 extractOutline 里存的是同一套。
 */
import type { Editor } from '@tiptap/core'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'

const LIST_TYPES = ['bulletList', 'orderedList', 'taskList']

/** 按 path 找到文档里的那个节点，以及它在文档中的起始位置 */
export function locate(doc: PMNode, path: number[]): { node: PMNode; pos: number } | null {
  let node: PMNode = doc
  let pos = 0
  for (const idx of path) {
    if (idx < 0 || idx >= node.childCount) return null
    let offset = 0
    for (let i = 0; i < idx; i += 1) offset += node.child(i).nodeSize
    // doc 的第一层子节点从位置 1 开始，所以每进一层要 +1
    pos = pos + 1 + offset
    node = node.child(idx)
  }
  return { node, pos }
}

/** p 是不是在 base 的子树里（用来挡住「把节点拖进自己的子孙」） */
export function isUnder(p: number[], base: number[]): boolean {
  if (p.length <= base.length) return false
  return base.every((v, i) => p[i] === v)
}

/**
 * 找节点里「写着文字的那一块」。
 *
 * 标题自己就是 textblock；列表项则是它第一个段落 —— 后面还可能跟着子列表，
 * 所以不能把整个 listItem 的内容当文本替换掉。
 * 返回的偏移是**相对该节点开头**的。
 */
function textBlockOf(node: PMNode): { node: PMNode; offset: number } | null {
  if (node.isTextblock) return { node, offset: 0 }
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i)
    if (!child.isTextblock) continue
    let offset = 1
    for (let j = 0; j < i; j += 1) offset += node.child(j).nodeSize
    return { node: child, offset }
  }
  return null
}

/** 这个节点能不能承载子节点（标题 / 段落 / 列表项） */
function canHostChildren(node: PMNode): boolean {
  return node.type.name === 'listItem' || node.isTextblock
}

type Slot = { at: number; mode: 'item' | 'list'; hostPath: number[] }

/**
 * 「往这个节点下面挂东西」应该插在哪、插什么形态。
 *
 * 三种情况：
 *   · 列表项已经有子列表 → 插到子列表末尾，形态是单个 listItem
 *   · 列表项还没有子列表 → 插在它自己末尾，形态是一整个新列表
 *   · 标题 / 段落          → 插在它后面，形态是一整个新列表
 */
function childSlotOf(doc: PMNode, path: number[]): Slot | null {
  const found = locate(doc, path)
  if (!found) return null
  const { node, pos } = found
  if (!canHostChildren(node)) return null

  if (node.type.name === 'listItem') {
    for (let i = 0; i < node.childCount; i += 1) {
      const child = node.child(i)
      if (!LIST_TYPES.includes(child.type.name)) continue
      let offset = 1
      for (let j = 0; j < i; j += 1) offset += node.child(j).nodeSize
      // 插进已有的子列表：新条目在这个节点**里面**
      return { at: pos + offset + child.nodeSize - 1, mode: 'item', hostPath: path }
    }
    // 在列表项末尾新建子列表：同样在它里面
    return { at: pos + node.nodeSize - 1, mode: 'list', hostPath: path }
  }

  // 标题 / 段落：新列表落在它**后面**，也就是父节点的孩子里
  return { at: pos + node.nodeSize, mode: 'list', hostPath: path.slice(0, -1) }
}

/** 造一个空条目：listItem > paragraph */
function emptyItem(editor: Editor): PMNode | null {
  const itemType = editor.schema.nodes.listItem
  const paraType = editor.schema.nodes.paragraph
  if (!itemType || !paraType) return null
  return itemType.create(null, paraType.create())
}

/* ---------------- 改文字 ---------------- */

/** 双击改字：只替换节点自己的文本，不动它的子节点 */
export function renameNode(editor: Editor, path: number[], text: string): boolean {
  const { state, view } = editor
  const found = locate(state.doc, path)
  if (!found) return false
  const block = textBlockOf(found.node)
  if (!block) return false

  const from = found.pos + block.offset
  const to = from + block.node.content.size
  const clean = text.trim()
  if (from === to && !clean) return false

  view.dispatch(state.tr.insertText(clean, from, to))
  return true
}

/* ---------------- 加子节点 ---------------- */

/** 在这个节点下面挂一个新的空条目，返回新节点的 path（好让界面立刻进入改名态） */
export function addChild(editor: Editor, path: number[]): number[] | null {
  const { state, view } = editor
  const found = locate(state.doc, path)
  const item = emptyItem(editor)
  if (!found || !item) return null
  const { node, pos } = found
  if (!canHostChildren(node)) return null

  const listType = editor.schema.nodes.bulletList
  if (!listType) return null

  // 统一用「整块替换」而不是「在某个偏移插入」——
  // 插入点会被 ProseMirror 按 schema 校正，落点未必是你算的那个位置；
  // 替换整块则是把新内容原样放回去，位置不会有歧义。
  let subIdx = -1
  for (let i = 0; i < node.childCount; i += 1) {
    if (LIST_TYPES.includes(node.child(i).type.name)) {
      subIdx = i
      break
    }
  }

  if (subIdx >= 0) {
    // 已经有子列表：把新条目接到它末尾
    const sub = node.child(subIdx)
    const grown = sub.type.create(sub.attrs, sub.content.append(Fragment.from(item)))
    let offset = 1
    for (let j = 0; j < subIdx; j += 1) offset += node.child(j).nodeSize
    view.dispatch(state.tr.replaceWith(pos + offset, pos + offset + sub.nodeSize, grown))
    return [...path, subIdx, sub.childCount]
  }

  // 没有子列表：在节点内容末尾接一个新列表
  const fresh = listType.create(null, [item])
  const grown = node.type.create(node.attrs, node.content.append(Fragment.from(fresh)))
  view.dispatch(state.tr.replaceWith(pos, pos + node.nodeSize, grown))

  if (node.type.name === 'listItem') {
    // 新列表成了这个列表项的最后一个子块
    return [...path, node.childCount, 0]
  }
  // 标题 / 段落：新列表落在它后面，也就是父节点的孩子里
  return [...path.slice(0, -1), path[path.length - 1] + 1, 0]
}

/* ---------------- 删节点 ---------------- */

/** 删掉这个节点连同它的整棵子树 */
export function deleteNode(editor: Editor, path: number[]): boolean {
  const { state, view } = editor
  if (!path.length) return false // 根节点不给删
  const found = locate(state.doc, path)
  if (!found) return false
  view.dispatch(state.tr.delete(found.pos, found.pos + found.node.nodeSize))
  return true
}

/* ---------------- 拖动调层级 ---------------- */

/**
 * 把 from 节点整棵搬到 to 节点下面，成为它的最后一个子节点。
 *
 * 顺序很讲究：先从文档里剪下来，**再用事务产出的新文档重新定位 to** ——
 * 删除会让目标前面的节点位置变化，沿用旧坐标必然插错地方。
 */
export function moveNode(editor: Editor, from: number[], to: number[]): boolean {
  const { state, view, schema } = editor
  if (!from.length || !to.length) return false
  if (isUnder(to, from) || from.join() === to.join()) return false

  const src = locate(state.doc, from)
  if (!src) return false

  const itemType = schema.nodes.listItem
  const listType = schema.nodes.bulletList
  if (!itemType || !listType) return false

  // 剪下来的东西统一成「单个 listItem」，挂不上列表时再包一层
  const itemNode =
    src.node.type.name === 'listItem' ? src.node : src.node.isTextblock ? itemType.create(null, src.node.content) : null
  if (!itemNode) return false

  let tr = state.tr.delete(src.pos, src.pos + src.node.nodeSize)
  const slot = childSlotOf(tr.doc, to)
  if (!slot) return false

  const payload =
    slot.mode === 'item'
      ? new Slice(Fragment.from(itemNode), 0, 0)
      : new Slice(Fragment.from(listType.create(null, [itemNode])), 0, 0)
  tr = tr.replace(slot.at, slot.at, payload)
  view.dispatch(tr)
  return true
}
