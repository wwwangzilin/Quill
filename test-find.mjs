// 查找匹配规则：大小写 / 全词 / 正则 / 替换展开（node 原生跑 TS）
import { FIND_DEFAULTS, findInText, isValidQuery, expandReplacement } from './src/core/findMatch.ts'

let ok = 0
function eq(name, got, want) {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  if (a !== b) {
    console.error(`✗ ${name}\n  期望: ${b}\n  实际: ${a}`)
    process.exit(1)
  }
  ok++
}
const pos = (t, q, o = {}) => findInText(t, q, { ...FIND_DEFAULTS, ...o }).map((h) => [h.start, h.end])

eq('默认不区分大小写', pos('Foo foo FOO', 'foo'), [[0, 3], [4, 7], [8, 11]])
eq('区分大小写', pos('Foo foo FOO', 'foo', { caseSensitive: true }), [[4, 7]])
eq('字面量里的正则符号被转义', pos('a.b axb', 'a.b'), [[0, 3]])
eq('全词', pos('cat concat cat.', 'cat', { wholeWord: true }), [[0, 3], [11, 14]])
eq('中文被别的字夹着不算全词，独立出现才算', pos('月光月 月光', '月光', { wholeWord: true }), [[4, 6]])
eq('正则', pos('a1 b22 c333', '\\d+', { regex: true }), [[1, 2], [4, 6], [8, 11]])
eq('空匹配被跳过', pos('abc', 'x*', { regex: true }), [])
eq('正则写错 → 无命中且标为无效', [pos('abc', '(', { regex: true }), isValidQuery('(', { ...FIND_DEFAULTS, regex: true })], [[], false])
eq('空查询有效', isValidQuery('', FIND_DEFAULTS), true)
const h = findInText('2026-11-21', '(\\d+)-(\\d+)-(\\d+)', { ...FIND_DEFAULTS, regex: true })[0]
eq('替换展开 $1', expandReplacement(h, '(\\d+)-(\\d+)-(\\d+)', '$3/$2/$1', { ...FIND_DEFAULTS, regex: true }), '21/11/2026')
eq('字面量模式不展开', expandReplacement(h, 'x', '$1', FIND_DEFAULTS), '$1')
console.log(`全部通过：${ok} 项`)
