// Minimal msgpack encoder that writes numeric string keys as uint32 integers.
// @msgpack/msgpack's stock encoder always encodes all object keys as msgpack strings.
// The Stadium's binary format uses uint32 integer keys (FourCC tags packed as big-endian uint32).

export function encodeIntKeys(value: unknown): Uint8Array {
  const chunks: Uint8Array[] = [];
  write(value, chunks);
  const len = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(len);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

function u8(n: number) { return new Uint8Array([n]); }
function u16be(n: number) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n); return b; }
function u32be(n: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; }
function i32be(n: number) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n); return b; }
function f32be(n: number) { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, n); return b; }
function f64be(n: number) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, n); return b; }
function concat(...parts: Uint8Array[]) { return parts; }

function writeStr(s: string, out: Uint8Array[]) {
  const bytes = new TextEncoder().encode(s);
  const len = bytes.length;
  if (len < 32) { out.push(u8(0xa0 | len)); }
  else if (len < 0x100) { out.push(u8(0xd9), u8(len)); }
  else if (len < 0x10000) { out.push(u8(0xda), u16be(len)); }
  else { out.push(u8(0xdb), u32be(len)); }
  out.push(bytes);
}

function writeBin(buf: Uint8Array, out: Uint8Array[]) {
  const len = buf.length;
  if (len < 0x100) { out.push(u8(0xc4), u8(len)); }
  else if (len < 0x10000) { out.push(u8(0xc5), u16be(len)); }
  else { out.push(u8(0xc6), u32be(len)); }
  out.push(buf);
}

function writeNum(n: number, out: Uint8Array[]) {
  if (Number.isInteger(n)) {
    if (n >= 0) {
      if (n < 128) { out.push(u8(n)); }
      else if (n < 0x100) { out.push(u8(0xcc), u8(n)); }
      else if (n < 0x10000) { out.push(u8(0xcd), u16be(n)); }
      else { out.push(u8(0xce), u32be(n)); }
    } else {
      if (n >= -32) { out.push(u8(0xe0 | (n + 32))); }
      else if (n >= -128) { out.push(u8(0xd0), new Uint8Array([n & 0xff])); }
      else if (n >= -32768) { out.push(u8(0xd1), i32be(n).slice(2)); }
      else { out.push(u8(0xd2), i32be(n)); }
    }
  } else {
    out.push(u8(0xcb), f64be(n));
  }
}

function write(value: unknown, out: Uint8Array[]) {
  if (value === null || value === undefined) { out.push(u8(0xc0)); return; }
  if (typeof value === "boolean") { out.push(u8(value ? 0xc3 : 0xc2)); return; }
  if (typeof value === "number") { writeNum(value, out); return; }
  if (typeof value === "string") { writeStr(value, out); return; }
  if (value instanceof Uint8Array || value instanceof Buffer) { writeBin(new Uint8Array((value as Uint8Array).buffer, (value as Uint8Array).byteOffset, (value as Uint8Array).byteLength), out); return; }
  if (Array.isArray(value)) {
    const len = value.length;
    if (len < 16) out.push(u8(0x90 | len));
    else if (len < 0x10000) out.push(u8(0xdc), u16be(len));
    else out.push(u8(0xdd), u32be(len));
    for (const item of value) write(item, out);
    return;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    const len = keys.length;
    if (len < 16) out.push(u8(0x80 | len));
    else if (len < 0x10000) out.push(u8(0xde), u16be(len));
    else out.push(u8(0xdf), u32be(len));
    for (const key of keys) {
      const n = parseInt(key, 10);
      if (!isNaN(n) && String(n) === key && n >= 0 && n <= 0xffffffff) {
        out.push(u8(0xce), u32be(n));   // integer key as uint32
      } else {
        writeStr(key, out);               // string key
      }
      write((value as Record<string, unknown>)[key], out);
    }
    return;
  }
}
