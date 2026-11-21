/**
 * 查找的匹配规则（纯函数，不碰编辑器）。
 * 默认：不区分大小写、按字面量匹配 —— 和加选项之前的行为完全一致。
 */
export interface FindOpts {
  /** 区分大小写 */
  caseSensitive: boolean
  /** 全词匹配（前后不能紧挨着字母/数字/下划线；中文里等于「不被别的字夹着」） */
  wholeWord: boolean
  /** 把查询当正则 */
  regex: boolean
}

export const FIND_DEFAULTS: FindOpts = { caseSensitive: false, wholeWord: false, regex: false }

export interface TextHit {
  start: number
  end: number
  /** 命中的原文；正则替换里的 $1 要靠它重新展开 */
  text: string
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 拼出正则；查询为空或正则写错返回 null */
export function buildFinder(query: string, o: FindOpts): RegExp | null {
  if (!query) return null
  let src = o.regex ? query : escapeRe(query)
  if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`
  try {
    return new RegExp(src, 'gu' + (o.caseSensitive ? '' : 'i'))
  } catch {
    return null
  }
}

/** 查询本身能不能用（正则写错时给界面一个红框） */
export function isValidQuery(query: string, o: FindOpts): boolean {
  return !query || buildFinder(query, o) !== null
}

/** 在一段文本里找出所有命中，空匹配跳过 */
export function findInText(text: string, query: string, o: FindOpts): TextHit[] {
  const re = buildFinder(query, o)
  if (!re) return []
  const out: TextHit[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m[0] === '') {
      re.lastIndex += 1
      continue
    }
    out.push({ start: m.index, end: m.index + m[0].length, text: m[0] })
  }
  return out
}

/** 展开替换串：正则模式下支持 $1 $& ，字面量模式原样返回 */
export function expandReplacement(hit: TextHit, query: string, replacement: string, o: FindOpts): string {
  if (!o.regex) return replacement
  const re = buildFinder(query, { ...o, wholeWord: false })
  if (!re) return replacement
  // 单独对命中的原文再匹配一遍，取出分组
  const single = new RegExp(re.source, re.flags.replace('g', ''))
  const m = single.exec(hit.text)
  if (!m) return replacement
  return replacement.replace(/\$(\d+|&|\$)/g, (_, k: string) =>
    k === '$' ? '$' : k === '&' ? m[0] : (m[Number(k)] ?? ''),
  )
}
