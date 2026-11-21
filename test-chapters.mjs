// 章节标题识别：第X章 / 特殊章名 / 英文 / 括号 / 数字序号兜底，以及不能误伤正文
import { extractChapters } from './src/core/chapters.ts'

let ok = 0
const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const heading = (t, level = 2) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text: t }] })
const titles = (...lines) => extractChapters({ type: 'doc', content: lines.map((l) => (typeof l === 'string' ? para(l) : l)) }).map((c) => c.title)
function eq(name, got, want) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`✗ ${name}\n  期望: ${JSON.stringify(want)}\n  实际: ${JSON.stringify(got)}`)
    process.exit(1)
  }
  ok++
}

eq('第X章 基本款', titles('第一章 开端', '正文。', '第十二章 回乡'), ['第一章 开端', '第十二章 回乡'])
eq('大写数字与〇', titles('第壹章 起', '第二〇章 落'), ['第壹章 起', '第二〇章 落'])
eq('幕 / 集 / 季', titles('第三幕 对决', '第2集 重逢', '第一季'), ['第三幕 对决', '第2集 重逢', '第一季'])
eq('序章 楔子 番外 尾声', titles('序章 雨夜', '楔子', '番外：后来', '尾声'), ['序章 雨夜', '楔子', '番外：后来', '尾声'])
eq('方括号包着的章名', titles('【第一章 开端】', '《第二章 继续》', '[第3章]'), ['第一章 开端', '第二章 继续', '第3章'])
eq('英文：Chapter 数字 / 罗马 / 单词', titles('Chapter 1', 'CHAPTER IV', 'Chapter Twelve', 'Prologue', 'Epilogue'), ['Chapter 1', 'CHAPTER IV', 'Chapter Twelve', 'Prologue', 'Epilogue'])
eq('Part 2 认，Book I read 不认', titles('Part 2', 'Book I read yesterday and loved it'), ['Part 2'])
eq('序 开头的正文句子不被误认', titles('序列已经排好了，他们依次走进房间。', '序号错了。'), [])
eq('正文里提到「第三章」不算', titles('他翻到第三章，读了很久。'), [])
eq('带句号的特殊词不算标题', titles('番外这一部分是后来补的。'), [])
eq('Markdown 标题优先', titles(heading('卷一 风起'), '第一章 开端'), ['卷一 风起', '第一章 开端'])
eq('数字序号：连续递增才认', titles('1、开端', '正文一', '2、转折', '正文二', '3、结局'), ['1、开端', '2、转折', '3、结局'])
eq('清单式数字不连续不认', titles('1. 买牛奶', '5. 交电费'), [])
eq('有「第X章」时不启用数字兜底', titles('第一章 a', '第二章 b', '1、不该算'), ['第一章 a', '第二章 b'])
eq('元信息裁剪仍然有效', titles('第一章 开端 作者：某人 更新时间：2026'), ['第一章 开端'])
console.log(`全部通过：${ok} 项`)
