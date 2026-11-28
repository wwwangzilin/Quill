import assert from 'node:assert/strict'
import { compileRule, splitByRule, toByteRanges, splitBlocksByRule, previewRule, PRESETS } from './src/core/chapterRule.ts'
let n = 0
const ok = (f) => { f(); n++ }
const T = '简介：一本书\n\n【序】\n开头正文\n【第一幕】\n正文一\n正文二\n【第二幕】\n正文三\n'
ok(() => assert.equal(compileRule(''), null))
ok(() => assert.equal(compileRule('(['), null)) // 写错不崩
ok(() => assert.ok(compileRule('^【')))
ok(() => {
  const re = compileRule('^【[^】]+】$')
  const c = splitByRule(T, re, '全文')
  assert.deepEqual(c.map((x) => x.title), ['全文', '【序】', '【第一幕】', '【第二幕】']) // 序言（简介）单独成章
  assert.equal(c[0].from, 0); assert.equal(c.at(-1).to, T.length)
  for (let i = 1; i < c.length; i++) assert.equal(c[i].from, c[i - 1].to) // 首尾相接，不丢字
})
ok(() => assert.deepEqual(splitByRule('没有标题\n只有正文', compileRule('^第.章'), '整篇'), [{ title: '整篇', from: 0, to: 9 }]))
ok(() => { // 超长行不当标题
  const long = '第一章' + '字'.repeat(200)
  assert.equal(splitByRule(long + '\n正文', compileRule('^第'), 'x').length, 1)
})
ok(() => { // Markdown 标题标记被去掉
  const c = splitByRule('## 第一章 开始\n正文', compileRule('^第'), 'x')
  assert.equal(c[0].title, '第一章 开始')
})
ok(() => { // 字符 → 字节：和 Buffer 算的一致（中文 3 字节、emoji 4 字节）
  const txt = '序\n第一章 你好🙂\n汉字正文\n第二章\nabc'
  const re = compileRule('^第.章')
  const ch = splitByRule(txt, re, 'x')
  const by = toByteRanges(txt, ch)
  for (let i = 0; i < ch.length; i++) {
    assert.equal(by[i].from, Buffer.byteLength(txt.slice(0, ch[i].from)))
    assert.equal(by[i].to, Buffer.byteLength(txt.slice(0, ch[i].to)))
  }
  assert.equal(by.at(-1).to, Buffer.byteLength(txt))
})
ok(() => {
  const r = splitBlocksByRule(['简介', '第一章', 'a', 'b', '第二章', 'c'], compileRule('^第.章$'), '全文')
  assert.deepEqual(r, [{ title: '全文', startBlock: 0, endBlock: 1 }, { title: '第一章', startBlock: 1, endBlock: 4 }, { title: '第二章', startBlock: 4, endBlock: 6 }])
})
ok(() => assert.deepEqual(splitBlocksByRule(['a', 'b'], compileRule('^第'), 't'), [{ title: 't', startBlock: 0, endBlock: 2 }]))
ok(() => { const p = previewRule([{ title: 'a', from: 0, to: 10 }, { title: 'b', from: 10, to: 30 }], 1); assert.deepEqual(p, { count: 2, samples: ['a'], avgLen: 15 }) })
ok(() => assert.deepEqual(previewRule([]), { count: 0, samples: [], avgLen: 0 }))
ok(() => { for (const p of PRESETS) assert.ok(compileRule(p.rule), p.name) }) // 预设都是合法正则
ok(() => { const c = splitByRule('第3章 起\nx\n第四回 承\ny', compileRule(PRESETS[0].rule), 'z'); assert.equal(c.length, 2) })
console.log(`全部通过：${n} 项`)
