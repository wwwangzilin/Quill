/**
 * 线性图标：24×24 网格、统一线宽、圆角端点，颜色跟着文字走（currentColor）。
 * 笔画是照 Lucide / Feather 这类开源线性图标的画法自己画的，没有搬任何第三方文件。
 *
 * 用法：
 *   <Icon name="pen" />                  直接按名字画
 *   <Glyph g="✎" />                      认得的符号字符换成图标，认不得的原样当文字显示
 * 后者是为了不动菜单 / 命令面板里现成的 icon: '⇩' 这种字符串配置。
 */

type Paths = string[]

const ICONS: Record<string, Paths> = {
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  sliders: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M2 14h4', 'M10 8h4', 'M18 16h4'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  pen: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  pin: [
    'M12 17v5',
    'M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
  ],
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M5 21h14'],
  upload: ['M12 21V9', 'M7 14l5-5 5 5', 'M5 3h14'],
  printer: [
    'M6 9V3h12v6',
    'M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2',
    'M6 14h12v7H6z',
  ],
  maximize: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'],
  quote: [
    'M3 21c3 0 7-1 7-8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h4',
    'M15 21c3 0 7-1 7-8V5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h4',
  ],
  clock: ['M12 7v5l3 2', 'M3 12a9 9 0 1 0 18 0 9 9 0 1 0-18 0'],
  updown: ['M7 4v16', 'M3 8l4-4 4 4', 'M17 20V4', 'M13 16l4 4 4-4'],
  // 8 齿齿轮：按几何算出来的（外圆 9.6、齿根 7.2），齿形均匀；中间一个孔
  settings: [
    'M9.89 5.11 L10.50 2.52 L13.50 2.52 L14.11 5.11 L15.38 5.64 L17.64 4.23 L19.77 6.36 L18.36 8.62 L18.89 9.89 L21.48 10.50 L21.48 13.50 L18.89 14.11 L18.36 15.38 L19.77 17.64 L17.64 19.77 L15.38 18.36 L14.11 18.89 L13.50 21.48 L10.50 21.48 L9.89 18.89 L8.62 18.36 L6.36 19.77 L4.23 17.64 L5.64 15.38 L5.11 14.11 L2.52 13.50 L2.52 10.50 L5.11 9.89 L5.64 8.62 L4.23 6.36 L6.36 4.23 L8.62 5.64 Z',
    'M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  ],
  sparkles: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z', 'M19 16v4', 'M17 18h4'],
  command: ['M15 6a3 3 0 1 1 3 3H6a3 3 0 1 1 3-3v12a3 3 0 1 1-3-3h12a3 3 0 1 1-3 3z'],
  sun: [
    'M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0',
    'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4',
    'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4',
  ],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'],
  search: ['M4 11a7 7 0 1 0 14 0 7 7 0 1 0-14 0', 'M21 21l-5-5'],
  star: ['M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z'],
  close: ['M18 6L6 18', 'M6 6l12 12'],
  expand: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
  bookmark: ['M6 3h12v18l-6-4-6 4z'],
  play: ['M7 4.5v15l12-7.5z'],
  pause: ['M8 5v14', 'M16 5v14'],
  check: ['M20 6L9 17l-5-5'],
  back: ['M19 12H5', 'M12 19l-7-7 7-7'],
  up: ['M12 19V5', 'M5 12l7-7 7 7'],
  down: ['M12 5v14', 'M19 12l-7 7-7-7'],
  refresh: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
  width: ['M3 12h18', 'M7 8l-4 4 4 4', 'M17 8l4 4-4 4'],
  file: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z', 'M14 3v6h6'],
  checksquare: ['M9 11l3 3 8-8', 'M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
  layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5'],
  shelf: ['M3 21h18', 'M5 21V8h4v13', 'M11 21V4h4v17', 'M17 21V10h3v11'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  chevleft: ['M15 18l-6-6 6-6'],
  chevright: ['M9 18l6-6-6-6'],
  chevup: ['M18 15l-6-6-6 6'],
  chevdown: ['M6 9l6 6 6-6'],
  book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'],
}

/** 符号字符 → 图标名。只收这个项目里真用到的 */
const GLYPHS: Record<string, string> = {
  '☰': 'menu', '🎛': 'sliders', '🗀': 'folder', '✎': 'pen', '📌': 'pin',
  '⇩': 'download', '⇧': 'upload', '⎙': 'printer', '⛶': 'maximize', '❝': 'quote',
  '⏱': 'clock', '⇅': 'updown', '⚙': 'settings', '✦': 'sparkles', '⌘': 'command',
  '☀': 'sun', '🗑': 'trash', '♻': 'trash', '⌕': 'search', '★': 'star', '✕': 'close',
  '✓': 'check', '←': 'back', '↑': 'up', '↓': 'down', '↻': 'refresh', '⇔': 'width',
  '📄': 'file', '☑': 'checksquare', '❏': 'layers', '▤': 'book',
}

interface IconProps {
  name: string
  /** 默认 1.15em，跟着字号走 */
  size?: number | string
  /** 实心（星标用） */
  filled?: boolean
  className?: string
}

export function Icon({ name, size, filled, className }: IconProps) {
  const paths = ICONS[name]
  if (!paths) return null
  const s = size ?? '1.15em'
  return (
    <svg
      className={'icon-svg' + (className ? ' ' + className : '')}
      data-icon={name}
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}

/** 认得的符号字符画成图标；认不得的（'H1'、'•' 之类）原样当文字 */
export function Glyph({ g, filled }: { g: string; filled?: boolean }) {
  const name = GLYPHS[g.trim()]
  return name ? <Icon name={name} filled={filled} /> : <>{g}</>
}

export default Icon
