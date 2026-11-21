import { useId } from 'react'

/**
 * 标题栏左侧的品牌标记：一根羽毛笔。
 *
 * 和应用图标（src-tauri/icons/icon-source.svg）是同一个造型，只是**不带青色底** ——
 * 18px 的小方块里再套一层底，羽毛就只剩一小团了；直接一根羽毛，配右边的「Quill」更清爽。
 *
 * 不用外链图标文件的原因：这是随主题走的前景元素，得跟着 CSS 变量和缩放进退；
 * 换成 img 的话缩放一次就糊，明暗主题下也没法单独调色。
 */

/** 羽面轮廓：和图标源文件里是同一条路径（细长、右侧一道裂口） */
const VANE =
  'M 512 100 C 600 160 668 276 660 396 L 604 450 L 658 500 C 646 582 592 654 530 712 L 512 744 L 486 712 C 434 648 390 556 394 436 C 398 296 448 176 512 100 Z'

export default function BrandMark({ size = 20 }: { size?: number }) {
  // 同一页里可能同时有好几个（标题栏、空状态…）：渐变和裁剪的 id 必须各用各的，
  // 否则后面的会去引用前面那个，前面那个一旦不在渲染树里就整个消失
  const uid = useId().replace(/:/g, '')
  const fillId = `quill-mark-fill-${uid}`
  const clipId = `quill-mark-vane-${uid}`
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      role="img"
      aria-label="Quill"
    >
      <defs>
        {/* 用主题变量而不是写死颜色：两套玻璃主题 + 自选强调色下都跟着走 */}
        <linearGradient id={fillId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent-1)" />
          <stop offset="100%" stopColor="var(--accent-2)" />
        </linearGradient>
        <clipPath id={clipId}>
          <path d={VANE} />
        </clipPath>
      </defs>
      <g transform="rotate(38 512 512)">
        <path d={VANE} fill={`url(#${fillId})`} />
        {/* 羽枝与羽轴：用底色压一道，小尺寸下羽面才不是一整块实心 */}
        <g
          clipPath={`url(#${clipId})`}
          fill="none"
          stroke="var(--bg)"
          strokeWidth="20"
          strokeLinecap="round"
          opacity="0.5"
        >
          <path d="M 512 640 L 604 578 M 512 560 L 628 498 M 512 400 L 640 338 M 512 320 L 624 258" />
          <path d="M 512 650 L 434 588 M 512 570 L 408 508 M 512 490 L 394 428 M 512 410 L 394 348" />
        </g>
        <path d="M 512 128 L 512 736" stroke="var(--bg)" strokeWidth="24" strokeLinecap="round" opacity="0.6" />
        <path d="M 498 700 L 512 932 L 526 700 Z" fill={`url(#${fillId})`} />
      </g>
    </svg>
  )
}
