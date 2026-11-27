/**
 * 摘录卡片：把一条划线（和批注）画成一张能发朋友圈 / 存相册的 PNG。
 * 不引依赖，直接 Canvas 2D；换行排版是纯函数（measure 注入），node 下可测。
 */
export type Measure = (s: string) => number

/** 不能出现在行首的标点（避头），遇到就把它挤回上一行 */
const NO_HEAD = new Set('，。、；：？！）】》」』”’…—,.;:?!)]}%'.split(''))

/**
 * 按宽度折行。CJK 逐字断；连续的英文/数字当一个词，放不下才整词换行，
 * 词本身超宽时再硬拆。\n 是段落硬换行。空段落保留成空行。
 */
export function wrapLines(text: string, maxW: number, measure: Measure): string[] {
  const out: string[] = []
  for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!para.trim()) {
      out.push('')
      continue
    }
    // 切成「词」：连续拉丁字符/数字是一个，其余逐字
    const tokens = para.match(/[A-Za-z0-9_'’\-.]+|\s+|[\s\S]/gu) ?? []
    let line = ''
    const push = () => {
      out.push(line.replace(/\s+$/, ''))
      line = ''
    }
    for (const tk of tokens) {
      if (!line && /^\s+$/.test(tk)) continue
      if (measure(line + tk) <= maxW) {
        line += tk
        continue
      }
      if (!line) {
        // 单个词就超宽：逐字硬拆
        for (const ch of tk) {
          if (line && measure(line + ch) > maxW) push()
          line += ch
        }
        continue
      }
      if (NO_HEAD.has(tk) && tk.length === 1) {
        // 避头：标点留在上一行末尾（略超宽可接受），不另起一行开头
        line += tk
        push()
        continue
      }
      push()
      if (/^\s+$/.test(tk)) continue
      if (measure(tk) > maxW) {
        for (const ch of tk) {
          if (line && measure(line + ch) > maxW) push()
          line += ch
        }
      } else line = tk
    }
    if (line) push()
  }
  return out
}

export interface CardTheme {
  id: string
  name: string
  bg: [string, string]
  ink: string
  sub: string
  line: string
}

export const CARD_THEMES: CardTheme[] = [
  { id: 'paper', name: '纸张', bg: ['#f8f1e1', '#efe3c8'], ink: '#3a3126', sub: '#85796a', line: 'rgba(80,60,30,.18)' },
  { id: 'glass', name: '玻璃', bg: ['#eaf4f6', '#cfe3ea'], ink: '#1d2b33', sub: '#5d7480', line: 'rgba(30,70,90,.18)' },
  { id: 'green', name: '护眼', bg: ['#e4f0de', '#cfe3c6'], ink: '#2a3a2b', sub: '#68806a', line: 'rgba(40,80,50,.2)' },
  { id: 'dark', name: '夜间', bg: ['#1d222b', '#12151a'], ink: '#e3e6ea', sub: '#8d95a1', line: 'rgba(255,255,255,.14)' },
]

export interface CardInput {
  quote: string
  note: string
  title: string
  /** 荧光笔色（十六进制）；不给用琥珀色 */
  accent?: string
  theme?: string
  /** 书法式衬线字体栈；不给用系统宋体系 */
  fontStack?: string
}

export const CARD_W = 1080
const PAD = 96

export interface CardLayout {
  height: number
  quoteLines: string[]
  noteLines: string[]
}

const QUOTE_PX = 46
const NOTE_PX = 34

/** 版面高度只取决于折行结果，单独算出来好测 */
export function layoutCard(input: Pick<CardInput, 'quote' | 'note'>, measureQuote: Measure, measureNote: Measure): CardLayout {
  const inner = CARD_W - PAD * 2
  const q = input.quote.replace(/\s*\n\s*/g, '\n').trim()
  const quoteLines = wrapLines(q, inner - 12, measureQuote)
  const noteLines = input.note.trim() ? wrapLines(input.note.trim(), inner - 12, measureNote) : []
  const qh = quoteLines.length * QUOTE_PX * 1.72
  const nh = noteLines.length ? 56 + noteLines.length * NOTE_PX * 1.65 : 0
  const height = Math.round(PAD + 120 + qh + nh + 150)
  return { height, quoteLines, noteLines }
}

export async function renderExcerptCard(input: CardInput): Promise<Blob> {
  const theme = CARD_THEMES.find((t) => t.id === input.theme) ?? CARD_THEMES[0]
  const stack = input.fontStack || '"Noto Serif SC","Source Han Serif SC","Songti SC","SimSun",serif'
  const accent = input.accent ?? '#d9a23b'
  const probe = document.createElement('canvas').getContext('2d')!
  probe.font = `${QUOTE_PX}px ${stack}`
  const mq: Measure = (s) => probe.measureText(s).width
  probe.font = `${NOTE_PX}px ${stack}`
  const mqNote: Measure = (s) => probe.measureText(s).width
  // measure 要跟着字体切：先量引文，再量批注，各自设好 font
  const lay = layoutCard(
    input,
    (s) => ((probe.font = `${QUOTE_PX}px ${stack}`), mq(s)),
    (s) => ((probe.font = `${NOTE_PX}px ${stack}`), mqNote(s)),
  )

  const scale = 2
  const cv = document.createElement('canvas')
  cv.width = CARD_W * scale
  cv.height = lay.height * scale
  const g = cv.getContext('2d')!
  g.scale(scale, scale)

  const grad = g.createLinearGradient(0, 0, CARD_W * 0.4, lay.height)
  grad.addColorStop(0, theme.bg[0])
  grad.addColorStop(1, theme.bg[1])
  g.fillStyle = grad
  g.fillRect(0, 0, CARD_W, lay.height)

  // 大引号
  g.fillStyle = accent
  g.globalAlpha = 0.9
  g.font = `bold 170px ${stack}`
  g.textBaseline = 'alphabetic'
  g.fillText('“', PAD - 8, PAD + 120)
  g.globalAlpha = 1

  // 引文：左侧一道荧光笔色的竖线
  let y = PAD + 150
  const qTop = y - QUOTE_PX
  g.font = `${QUOTE_PX}px ${stack}`
  g.fillStyle = theme.ink
  for (const l of lay.quoteLines) {
    g.fillText(l, PAD + 12, y)
    y += QUOTE_PX * 1.72
  }
  g.fillStyle = accent
  g.fillRect(PAD - 14, qTop, 6, y - QUOTE_PX * 1.72 - qTop + QUOTE_PX * 1.1)

  if (lay.noteLines.length) {
    y += 8
    g.strokeStyle = theme.line
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(PAD, y)
    g.lineTo(PAD + 120, y)
    g.stroke()
    y += 56
    g.font = `${NOTE_PX}px ${stack}`
    g.fillStyle = theme.sub
    for (const l of lay.noteLines) {
      g.fillText(l, PAD + 12, y)
      y += NOTE_PX * 1.65
    }
  }

  // 页脚：书名 + 品牌
  const fy = lay.height - 70
  g.strokeStyle = theme.line
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(PAD, fy - 44)
  g.lineTo(CARD_W - PAD, fy - 44)
  g.stroke()
  g.fillStyle = theme.sub
  g.font = `28px ${stack}`
  const name = `《${input.title.replace(/[《》]/g, '')}》`
  let shown = name
  while (shown.length > 3 && probe.measureText(shown).width > 0 && (g.measureText(shown).width > CARD_W - PAD * 2 - 160)) {
    shown = shown.slice(0, -2) + '…》'
  }
  g.fillText(shown, PAD, fy)
  g.textAlign = 'right'
  g.fillText('Quill', CARD_W - PAD, fy)

  return await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('生成图片失败'))), 'image/png'))
}
