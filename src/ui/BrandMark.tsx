/**
 * 标题栏左侧的品牌标记：一根金色的羽毛。
 *
 * 和应用图标（src-tauri/icons/icon-source.svg）是同一个造型，只是**不带金底** ——
 * 18px 的小方块里再套一层金底，羽毛就只剩一个黑点了；直接一根金羽毛，
 * 配右边的「Quill」还更清爽。
 *
 * 不用外链图标文件的原因：这是随主题走的前景元素，得跟着 CSS 变量和缩放进退；
 * 换成 img 的话缩放一次就糊，暗色/浅色主题下也没法单独调色。
 */
export default function BrandMark({ size = 20 }: { size?: number }) {
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
        {/* 用主题变量而不是写死金色：玻璃两套主题 + 自选强调色下都跟着走 */}
        <linearGradient id="quill-mark-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent-1)" />
          <stop offset="100%" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>
      <g transform="rotate(-30 512 512)">
        <path
          d="M 512 158 C 672 322 730 542 652 694 C 608 782 558 838 512 892
             C 466 838 416 782 372 694 C 294 542 352 322 512 158 Z"
          fill="url(#quill-mark-gold)"
        />
        {/* 羽轴：压深一点，否则小尺寸下整根羽毛是一块实心金 */}
        <path
          d="M 512 196 L 512 826"
          stroke="var(--bg)"
          strokeWidth="15"
          strokeLinecap="round"
          opacity="0.55"
        />
      </g>
    </svg>
  )
}
