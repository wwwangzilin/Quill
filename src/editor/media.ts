import { Node, mergeAttributes } from '@tiptap/core'

/**
 * 视频块。
 * Markdown 没有标准的视频语法，这里用 HTML `<video>` 标签 ——
 * 写进 .md 文件后仍然是可读的标签，别的编辑器也认。
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
    return [{ tag: 'video[src]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'video',
      mergeAttributes(HTMLAttributes, {
        controls: 'true',
        preload: 'metadata',
        class: 'quill-video',
      }),
    ]
  },
})
