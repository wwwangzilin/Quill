import assert from 'node:assert/strict'
import { updateCpm, remaining, minutesFor, fmtEta, clampCpm, DEFAULT_CPM } from './src/core/readSpeed.ts'
let n = 0
const ok = (f) => { f(); n++ }
ok(() => assert.equal(updateCpm(400, 500, 1000), 400)) // 太快：不计
ok(() => assert.equal(updateCpm(400, 500, 200000), 400)) // 挂机：不计
ok(() => assert.equal(updateCpm(400, 0, 30000), 400))
ok(() => assert.equal(updateCpm(400, 5000, 30000), 400)) // 扫读 10000 字/分：不计
ok(() => { const v = updateCpm(400, 300, 60000); assert.equal(v, 400 * 0.8 + 300 * 0.2) }) // 300 字/分
ok(() => { let v = 400; for (let i = 0; i < 80; i++) v = updateCpm(v, 200, 60000); assert.ok(Math.abs(v - 200) < 2) }) // 收敛
ok(() => assert.equal(clampCpm(10), 120)); ok(() => assert.equal(clampCpm(9999), 1200))
ok(() => assert.deepEqual(remaining([1000, 2000, 3000], 0, 0.5), [500, 5500]))
ok(() => assert.deepEqual(remaining([1000, 2000, 3000], 2, 1), [0, 0]))
ok(() => assert.deepEqual(remaining([1000], 5, 0), [0, 0])) // 越界不崩
ok(() => assert.deepEqual(remaining([1000, 2000], 0, 3), [0, 2000])) // frac 夹到 1
ok(() => assert.equal(minutesFor(4000, 400), 10))
ok(() => { assert.equal(fmtEta(0.3), '不到 1 分钟'); assert.equal(fmtEta(12.4), '12 分钟'); assert.equal(fmtEta(60), '1 小时'); assert.equal(fmtEta(135), '2 小时 15 分'); assert.equal(fmtEta(119.7), '2 小时') })
ok(() => assert.equal(DEFAULT_CPM, 400))
console.log(`全部通过：${n} 项`)
