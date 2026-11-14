import { useCallback, type RefObject } from 'react'
import type { JSONContent, Editor } from '@tiptap/core'
import { toast } from '../ui/toast'
import { importMarkdown, isDesktop, readMarkdownFolder, readPathsAsDocs } from '../core/desktop'
import { docToMarkdown, safeFileName } from '../core/markdown'
import type { Doc } from '../core/types'
import { download, buildStandaloneHtml } from './exportUtils'

/**
 * 导出（Markdown / HTML / PDF / JSON / 富文本）与导入（文件夹 / 文本文件 / 拖入路径）。
 */
export function useExportImport(opts: {
  docRef: RefObject<Doc | null>
  liveRef: RefObject<{ title: string; content: JSONContent } | null>
  editorRef: RefObject<Editor | null>
  refreshDocs: () => Promise<void>
}) {
  const { docRef, liveRef, editorRef, refreshDocs } = opts

  /** 复制为富文本：保留标题、列表与强调格式，可直接粘贴到 Word / 公众号 */
  const copyRichText = useCallback(async () => {
    const ed = editorRef.current
    if (!ed || ed.isDestroyed) {
      toast.info('请先打开一篇文档')
      return
    }
    try {
      const html = ed.getHTML()
      const text = ed.getText()
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ])
      toast.success('已复制为富文本', '粘贴到 Word、公众号等编辑器仍保留格式')
    } catch (err) {
      toast.error('复制失败', String(err).slice(0, 120))
    }
  }, [])

  const exportMd = useCallback(() => {
    const live = liveRef.current
    if (!live) return
    download(
      `${safeFileName(live.title)}.md`,
      docToMarkdown(live.content, live.title),
      'text/markdown',
    )
    toast.success('已导出 Markdown', `${safeFileName(live.title)}.md`)
  }, [])

  const exportJson = useCallback(() => {
    const live = liveRef.current
    if (!live || !docRef.current) return
    const payload = { ...docRef.current, title: live.title, content: live.content }
    download(`${safeFileName(live.title)}.json`, JSON.stringify(payload, null, 2), 'application/json')
  }, [])

  /** 导出单文件 HTML：样式全内联，直接发出去别人也能看 */
  const exportHtml = useCallback(() => {
    const ed = editorRef.current
    const live = liveRef.current
    if (!ed || ed.isDestroyed || !live) return
    const name = `${safeFileName(live.title)}.html`
    download(name, buildStandaloneHtml(live.title, ed.getHTML()), 'text/html')
    toast.success('已导出 HTML', name)
  }, [])

  /**
   * 导出 PDF：走系统打印，在打印机列表里选「Microsoft Print to PDF」。
   * 不引 jsPDF 那一类库 —— 它们是截图拼的，中文和排版都会糊；
   * 系统打印出的是矢量文本，还能选中复制。
   */
  const exportPdf = useCallback(() => {
    if (!docRef.current) return
    toast.info('在系统打印窗口中选择「Microsoft Print to PDF」', '导出 PDF')
    window.setTimeout(() => window.print(), 120)
  }, [])

  /** 把选出来的文件真正导进去 —— .txt 在读的时候就已经转成 Markdown 了 */
  const runImport = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || !files.length) return
      try {
        const items = await readMarkdownFolder(files)
        if (!items.length) {
          toast.info('未找到可导入的文本文件', '支持 .md / .markdown / .txt')
          return
        }
        const n = await importMarkdown(items)
        await refreshDocs()
        toast.success(`已导入 ${n} 篇文档`, '同名文件自动加序号，不会覆盖')
      } catch (err) {
        toast.error('导入失败', String(err).slice(0, 120))
      }
    },
    [refreshDocs],
  )

  /**
   * 打开系统的文件选择框。
   * dir = true 选整个文件夹（搬 Obsidian / Notion 的库），false 挑几个文件。
   */
  const pickFiles = useCallback(
    (dir: boolean) => {
      if (!isDesktop()) {
        toast.info('导入功能仅在桌面版可用')
        return
      }
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      if (dir) {
        input.setAttribute('webkitdirectory', '')
        input.setAttribute('directory', '')
      } else {
        input.accept = '.txt,.text,.md,.markdown,text/plain'
      }
      input.onchange = () => void runImport(input.files)
      input.click()
    },
    [runImport],
  )

  /** 选一个文件夹，把里面的 Markdown 全搬进来（Obsidian / Notion 导出的就是这种） */
  const importFolder = useCallback(() => pickFiles(true), [pickFiles])

  /** 挑几个文本文件导进来；.txt 会自动识别编码并转成 Markdown */
  const importFiles = useCallback(() => pickFiles(false), [pickFiles])

  /**
   * 拖进来的文件路径 → 导入成新文档。
   *
   * 桌面版拖拽走的是 Tauri 原生事件，给的是磁盘路径（不是 File 对象），
   * 所以这条和上面那几个入口不是一回事，得单独接。
   */
  const importPaths = useCallback(
    async (paths: string[]) => {
      try {
        const items = await readPathsAsDocs(paths)
        if (!items.length) {
          toast.info('不支持的文件类型', '仅支持 .md / .markdown / .txt')
          return
        }
        const n = await importMarkdown(items)
        await refreshDocs()
        toast.success(`已导入 ${n} 篇文档`, '同名文件自动加序号，不会覆盖')
      } catch (err) {
        toast.error('导入失败', String(err).slice(0, 120))
      }
    },
    [refreshDocs],
  )

  return {
    copyRichText,
    exportMd,
    exportJson,
    exportHtml,
    exportPdf,
    runImport,
    importFolder,
    importFiles,
    importPaths,
  }
}
