import assert from 'node:assert/strict'
import { cleanForSpeech, splitSpeech, pickVoice } from './src/core/tts.ts'
let n = 0
const ok = (f) => { f(); n++ }
ok(() => assert.deepEqual(splitSpeech('他来了。她走了！谁知道呢？'), ['他来了。她走了！', '谁知道呢？']))
ok(() => assert.deepEqual(splitSpeech('“你好。”他说。她笑了笑，没有回答。'), ['“你好。”他说。', '她笑了笑，没有回答。']))
ok(() => assert.deepEqual(splitSpeech('好。'), ['好。']))
ok(() => assert.deepEqual(splitSpeech('好。今天天气很不错，我们出去走走吧。'), ['好。今天天气很不错，我们出去走走吧。'])) // 短句并入下一句
ok(() => assert.deepEqual(splitSpeech('……'), []))
ok(() => assert.deepEqual(splitSpeech('***'), []))
ok(() => assert.deepEqual(splitSpeech(''), []))
ok(() => assert.equal(cleanForSpeech('## 第一章 **开端**'), '第一章 开端'))
ok(() => assert.equal(cleanForSpeech('![图](assets/a.png)'), ''))
ok(() => { const long = '很长的一句话'.repeat(40) + '。'; const p = splitSpeech(long, 60); assert.ok(p.length > 3 && p.every((s) => [...s].length <= 62)); assert.equal(p.join(''), long) }) // 收尾标点并回上一块，允许略超
ok(() => { const p = splitSpeech('甲，'.repeat(80), 40); assert.ok(p.every((s) => [...s].length <= 40)) })
ok(() => assert.deepEqual(splitSpeech('Hello world. 你好！'), ['Hello world. 你好！']))
const V = [{ name: 'English', lang: 'en-US' }, { name: 'Huihui', lang: 'zh-CN' }, { name: 'Xiaoxiao Online (Natural)', lang: 'zh-CN' }, { name: 'Zh-HK', lang: 'zh-HK', default: true }]
ok(() => assert.equal(pickVoice(V).name, 'Xiaoxiao Online (Natural)'))
ok(() => assert.equal(pickVoice(V, 'zh-CN', 'Huihui').name, 'Huihui'))
ok(() => assert.equal(pickVoice(V, 'zh-CN', '不存在').name, 'Xiaoxiao Online (Natural)'))
ok(() => assert.equal(pickVoice([V[0]], 'zh-CN'), undefined))
console.log(`全部通过：${n} 项`)
