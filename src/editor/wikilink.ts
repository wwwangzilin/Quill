import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** `[[文档名]]` — 与 Obsidian / 大多数笔记工具通用的语法 */
export const WIKILINK = /\[\[([^\]\n]+)\]\]/g

/**
 * 把正文里的 [[标题]] 渲染成可点击的小标签。
 * 只做装饰、不改文档结构：写进 .md 文件里的仍是原样的 [[标题]]，
 * 换成别的编辑器打开也认得。
 */
export const WikiLink = Extension.create({
  name: 'quillWikiLink',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('quillWikiLink'),
        props: {
          decorations(state) {
            const decos: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              const re = new RegExp(WIKILINK.source, 'g')
              let m: RegExpExecArray | null
              while ((m = re.exec(node.text)) !== null) {
                const target = m[1].trim()
                if (!target) continue
                decos.push(
                  Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
                    class: 'wikilink',
                    'data-target': target,
                  }),
                )
              }
            })
            return decos.length ? DecorationSet.create(state.doc, decos) : null
          },
        },
      }),
    ]
  },
})

/** 从一段文本里抽出所有 [[链接]] 目标 */
export function extractLinks(text: string): string[] {
  const re = new RegExp(WIKILINK.source, 'g')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const t = m[1].trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/** 从编辑器 JSON 里抽出所有链接目标（给反向链接用） */
export function linksInJson(node: unknown): string[] {
  const texts: string[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const obj = n as { type?: string; text?: string; content?: unknown[] }
    if (obj.type === 'text' && typeof obj.text === 'string') texts.push(obj.text)
    obj.content?.forEach(walk)
  }
  walk(node)
  return extractLinks(texts.join('\n'))
}
