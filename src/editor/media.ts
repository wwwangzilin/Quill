import { Node, mergeAttributes } from '@tiptap/core'
import { assetUrl, relOf } from '../core/asset'

/**
 * 视频块。
 * Markdown 没有标准的视频语法，这里用 HTML `<video>` 标签 ——
 * 写进 .md 文件后仍然是可读的标签，别的编辑器也认。
 *
 * 关于 src：文档数据里永远是仓库相对路径（`assets/xxx.mp4`），
 * 只有渲染那一刻才换成 WebView 取得到的 asset:// URL。
 * 这样换机器、拿别的编辑器打开、推远程备份都不会失效。
 */
export const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      title: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'video[src]',
        // DOM 里的 src 可能已经是 asset:// 了（复制粘贴自身内容时就是这样），
        // 解析回文档时必须还原成相对路径
        getAttrs: (el) => {
          const node = el as HTMLElement
          return {
            src: relOf(node.getAttribute('src') ?? ''),
            title: node.getAttribute('title'),
          }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'video',
      mergeAttributes(HTMLAttributes, {
        src: assetUrl(String(HTMLAttributes.src ?? '')),
        controls: 'true',
        preload: 'metadata',
        class: 'quill-video',
      }),
    ]
  },
})
