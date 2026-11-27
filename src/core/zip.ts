/**
 * 最小的 zip 写入器：只存不压（PNG 本来就压过了），UTF-8 文件名。
 * 够「把一批图片打成一个包」用，不引依赖。
 */
export interface ZipFile {
  name: string
  data: Uint8Array
  /** 修改时间，默认现在 */
  date?: Date
}

let table: Uint32Array | null = null
export function crc32(buf: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dos(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

export function makeZip(files: ZipFile[]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const { time, date } = dos(f.date ?? new Date())
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // bit 11：文件名是 UTF-8
    local.setUint16(8, 0, true) // 存储，不压缩
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, f.data.length, true)
    local.setUint32(22, f.data.length, true)
    local.setUint16(26, name.length, true)
    local.setUint16(28, 0, true)
    parts.push(new Uint8Array(local.buffer), name, f.data)

    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint16(10, 0, true)
    c.setUint16(12, time, true)
    c.setUint16(14, date, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, f.data.length, true)
    c.setUint32(24, f.data.length, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    central.push(new Uint8Array(c.buffer), name)
    offset += 30 + name.length + f.data.length
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, cdSize, true)
  end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of all) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** 文件名里不能有的字符换成下划线，并限长（按字，不按字节） */
export function safeName(s: string, max = 24): string {
  return [...s.replace(/[\\/:*?"<>|\r\n\t]+/g, '_').trim()].slice(0, max).join('') || '未命名'
}
