/**
 * 朗读：把一段话切成适合 speechSynthesis 逐句念的小块。纯函数，node 下可测。
 *
 * 为什么要切：一整段 200 字塞给 speechSynthesis，Chromium 系（含 WebView2）在某些
 * 在线音色上念到十几秒就会静默中断，onend 也不触发，整个朗读就卡死。
 * 切成句子后每块都很短，既不会断，也能在句间响应暂停 / 换语速。
 */

const OPEN = new Set('“‘（《「『【([{'.split(''))
const CLOSE = new Set('”’）》」』】)]}'.split(''))
const STOP = new Set('。！？!?；;…'.split(''))

/** 去掉念出来没意义的东西：Markdown 记号、连续符号行；返回空串表示整段不用念 */
export function cleanForSpeech(s: string): string {
  const t = s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[*_`#>~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // 没有一个字母/数字/汉字 —— 分隔线、省略号行之类，念出来是「点点点」
  return /[\p{L}\p{N}]/u.test(t) ? t : ''
}

/**
 * 按句末标点切；引号/括号收尾跟在标点后面一起走；太短的并给下一句；
 * 单句仍超长就在逗号 / 顿号处再切，最后才硬切。
 */
export function splitSpeech(text: string, max = 90): string[] {
  const t = cleanForSpeech(text)
  if (!t) return []
  const raw: string[] = []
  let cur = ''
  const chars = [...t]
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i]
    cur += c
    if (STOP.has(c)) {
      // 连续的标点（？！ ……）和收尾的引号括号一起带上
      while (i + 1 < chars.length && (STOP.has(chars[i + 1]) || CLOSE.has(chars[i + 1]))) {
        cur += chars[i + 1]
        i += 1
      }
      raw.push(cur)
      cur = ''
    }
  }
  if (cur.trim()) raw.push(cur)

  const out: string[] = []
  const flush = (s: string) => {
    const x = s.trim()
    if (!x) return
    if (/[\p{L}\p{N}]/u.test(x)) out.push(x)
    // 切出来只剩标点（比如长句末尾那个「。」）：并回上一块，别丢
    else if (out.length) out[out.length - 1] += x
  }
  for (const piece of raw) {
    if ([...piece].length <= max) {
      flush(piece)
      continue
    }
    // 超长：先按逗号顿号切
    let buf = ''
    for (const c of piece) {
      buf += c
      if ('，、,：:'.includes(c) && [...buf].length >= max * 0.5) {
        flush(buf)
        buf = ''
      } else if ([...buf].length >= max) {
        flush(buf)
        buf = ''
      }
    }
    flush(buf)
  }
  // 太短的（比如孤零零一句「好。」）并进下一句，少一次起停
  const merged: string[] = []
  for (const s of out) {
    const last = merged[merged.length - 1]
    if (last && [...last].length < 6 && [...last].length + [...s].length <= max) merged[merged.length - 1] = last + s
    else merged.push(s)
  }
  return merged
}

export const READ_RATES = [0.8, 1, 1.2, 1.5, 1.8, 2.2] as const

/** 挑默认音色：优先和界面语言一致（中文），其次同语种前缀，最后系统默认 */
export function pickVoice<T extends { lang: string; name: string; default?: boolean }>(
  voices: T[],
  lang = 'zh-CN',
  saved?: string | null,
  key: (v: T) => string = (v) => v.name,
): T | undefined {
  if (saved) {
    const hit = voices.find((v) => key(v) === saved)
    if (hit) return hit
  }
  const norm = (s: string) => s.replace('_', '-').toLowerCase()
  const exact = voices.filter((v) => norm(v.lang) === norm(lang))
  const same = voices.filter((v) => norm(v.lang).startsWith(norm(lang).split('-')[0]))
  const pool = exact.length ? exact : same
  // 名字里带 Natural / Neural / 晓 的一般是新一代音色，听着舒服得多
  return pool.find((v) => /natural|neural|online|晓|云/i.test(v.name)) ?? pool.find((v) => v.default) ?? pool[0]
}

/** 当前段落是不是已经念到了最后一句 */
export const isLast = (i: number, n: number) => i >= n - 1
