// zip 写入器自检：crc32、文件名清洗、写出来的包能不能读回去
//
// 原来最后一项是调 python3 -c 用 zipfile 校验 —— Windows 上 python3 常常是
// 应用商店的壳子，CI 会挂。这里改成自己按 ZIP 结构把包读回来。
import assert from 'node:assert/strict'
import { makeZip, crc32, safeName } from './src/core/zip.ts'

let n = 0
const ok = (f) => {
  f()
  n++
}

ok(() => assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)) // 标准校验值
ok(() => assert.equal(crc32(new Uint8Array(0)), 0))
ok(() => assert.equal(safeName('a/b:c*?.png'), 'a_b_c_.png'))
ok(() => assert.equal(safeName('长'.repeat(50)).length, 24))
ok(() => assert.equal(safeName('  '), '未命名'))

/** 只读我们这种「存储不压缩」的包：顺着本地头把每个条目捞出来 */
function readZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const dec = new TextDecoder()
  const out = {}
  let p = 0
  while (p + 4 <= buf.length) {
    const sig = dv.getUint32(p, true)
    if (sig !== 0x04034b50) break
    const method = dv.getUint16(p + 8, true)
    const size = dv.getUint32(p + 18, true)
    const nameLen = dv.getUint16(p + 26, true)
    const extraLen = dv.getUint16(p + 28, true)
    const name = dec.decode(buf.subarray(p + 30, p + 30 + nameLen))
    const dataAt = p + 30 + nameLen + extraLen
    assert.equal(method, 0, '这个写入器只存不压')
    out[name] = buf.subarray(dataAt, dataAt + size)
    p = dataAt + size
  }
  return out
}

const files = [
  { name: '001-月下.png', data: new Uint8Array([137, 80, 78, 71, 0, 255, 1, 2, 3]) },
  { name: '子目录/002-空.txt', data: new Uint8Array(0) },
  { name: '003.bin', data: Uint8Array.from({ length: 70000 }, (_, i) => i % 251) },
]
const zip = makeZip(files)
const back = readZip(zip)
ok(() => assert.deepEqual(Object.keys(back), ['001-月下.png', '子目录/002-空.txt', '003.bin']))
ok(() => assert.equal(back['001-月下.png'].length, 9))
ok(() => assert.equal(back['子目录/002-空.txt'].length, 0))
ok(() => assert.deepEqual([...back['003.bin']].slice(0, 5), [0, 1, 2, 3, 4]))
ok(() => assert.equal(back['003.bin'].length, 70000))
// 每个条目的 CRC 也要对得上
ok(() => assert.equal(crc32(back['003.bin']), crc32(files[2].data)))
ok(() => assert.equal(makeZip([]).length, 22)) // 空包只有结尾记录

console.log(`全部通过：${n} 项`)
