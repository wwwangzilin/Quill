import assert from 'node:assert/strict'
import { parseHM, inWindow, isNight, effectiveTheme, normalizeNight, DEFAULT_NIGHT } from './src/core/autoNight.ts'
let n = 0
const ok = (f) => { f(); n++ }
const at = (h, m = 0) => new Date(2026, 10, 28, h, m)
const cfg = { on: true, from: '21:00', to: '06:00' }
ok(() => { assert.equal(parseHM('21:00'), 1260); assert.equal(parseHM('6:05'), 365); assert.equal(parseHM('24:00'), null); assert.equal(parseHM('abc'), null); assert.equal(parseHM('12:60'), null) })
ok(() => { assert.equal(inWindow(1300, 1260, 360), true); assert.equal(inWindow(100, 1260, 360), true); assert.equal(inWindow(720, 1260, 360), false) }) // 跨午夜
ok(() => { assert.equal(inWindow(1260, 1260, 360), true); assert.equal(inWindow(360, 1260, 360), false) }) // 含起点、不含终点
ok(() => { assert.equal(inWindow(600, 480, 1080), true); assert.equal(inWindow(1100, 480, 1080), false) }) // 不跨午夜
ok(() => assert.equal(inWindow(500, 500, 500), false))
ok(() => { assert.equal(isNight(cfg, at(22)), true); assert.equal(isNight(cfg, at(5, 59)), true); assert.equal(isNight(cfg, at(6)), false); assert.equal(isNight(cfg, at(12)), false) })
ok(() => assert.equal(isNight({ ...cfg, on: false }, at(23)), false))
ok(() => assert.equal(isNight({ on: true, from: 'x', to: '06:00' }, at(23)), false)) // 坏配置不乱切
ok(() => { assert.equal(effectiveTheme('paper', cfg, at(23), 'dark'), 'dark'); assert.equal(effectiveTheme('paper', cfg, at(12), 'dark'), 'paper') })
ok(() => { assert.deepEqual(normalizeNight(null), DEFAULT_NIGHT); assert.deepEqual(normalizeNight({ on: true, from: '22:30', to: 'bad' }), { on: true, from: '22:30', to: '06:00' }) })
console.log(`全部通过：${n} 项`)
