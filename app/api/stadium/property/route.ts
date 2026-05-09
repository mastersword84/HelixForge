import { NextRequest } from "next/server";
import * as zmq from "zeromq";
import { decode } from "@msgpack/msgpack";
import { encodeIntKeys } from "@/lib/stadium/msgpack-int-keys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── FourCC constants for the property blob schema ────────────────────────────
// Each 4-char ASCII string packed as big-endian uint32.
const K_KEY_  = 1801812319;  // "key_"  0x6B65795F
const K_TYPE  = 1954115685;  // "type"  0x74797065
const K_VAL_  = 1986096223;  // "val_"  0x76616C5F

// ── OSC helpers ──────────────────────────────────────────────────────────────

function padTo4(len: number) { return Math.ceil(len / 4) * 4; }

function encodeStr(s: string): Buffer {
  const bytes = Buffer.from(s + "\x00", "utf8");
  const padded = Buffer.alloc(padTo4(bytes.length));
  bytes.copy(padded);
  return padded;
}

function encodeOSC(address: string, typeTags: string, args: (number | string)[]): Buffer {
  const addrBuf = encodeStr(address);
  const tagBuf  = encodeStr("," + typeTags);
  const argBufs: Buffer[] = [];
  for (let i = 0; i < args.length; i++) {
    const tag = typeTags[i];
    const arg = args[i];
    if (tag === "i") { const b = Buffer.alloc(4); b.writeInt32BE(arg as number); argBufs.push(b); }
    else if (tag === "s") { argBufs.push(encodeStr(arg as string)); }
  }
  return Buffer.concat([addrBuf, tagBuf, ...argBufs]);
}

// Encode PropertyValueSet ,isb [reqId, path, blob]
function encodePropertySet(path: string, blob: Buffer): Buffer {
  const addrBuf = encodeStr("/PropertyValueSet");
  const tagBuf  = encodeStr(",isb");
  const reqBuf  = Buffer.alloc(4); reqBuf.writeInt32BE(1);
  const pathBuf = encodeStr(path);
  const lenBuf  = Buffer.alloc(4); lenBuf.writeUInt32BE(blob.length);
  const padded  = Buffer.alloc(padTo4(blob.length));
  blob.copy(padded);
  return Buffer.concat([addrBuf, tagBuf, reqBuf, pathBuf, lenBuf, padded]);
}

function decodeOSC(buf: Buffer): { address: string; typeTags: string; args: unknown[] } | null {
  try {
    let offset = 0;
    function readStr(): string {
      const end = buf.indexOf(0, offset);
      const s = buf.toString("utf8", offset, end);
      offset = padTo4(end + 1);
      return s;
    }
    const address = readStr();
    const tagStr  = readStr();
    const typeTags = tagStr.startsWith(",") ? tagStr.slice(1) : tagStr;
    const args: unknown[] = [];
    for (const tag of typeTags) {
      if (tag === "i") { args.push(buf.readInt32BE(offset)); offset += 4; }
      else if (tag === "h") {
        const hi = BigInt(buf.readInt32BE(offset));
        const lo = BigInt(buf.readUInt32BE(offset + 4));
        args.push(Number((hi << BigInt(32)) | lo)); offset += 8;
      }
      else if (tag === "f") { args.push(buf.readFloatBE(offset)); offset += 4; }
      else if (tag === "d") { args.push(buf.readDoubleBE(offset)); offset += 8; }
      else if (tag === "s") { args.push(readStr()); }
      else if (tag === "b") {
        const len = buf.readUInt32BE(offset); offset += 4;
        args.push({ _b64: buf.slice(offset, offset + len).toString("base64"), _len: len });
        offset += padTo4(len);
      }
      else if (tag === "T") { args.push(true); }
      else if (tag === "F") { args.push(false); }
      else if (tag === "N") { args.push(null); }
      else { args.push(`<${tag}?>`); }
    }
    return { address, typeTags, args };
  } catch { return null; }
}

// ── ZMQ ─────────────────────────────────────────────────────────────────────

async function queryOnce(ip: string, osc: Buffer): Promise<Buffer | null> {
  const sock = new zmq.Dealer();
  await sock.connect(`tcp://${ip}:2002`);
  await new Promise((r) => setTimeout(r, 150));
  try {
    await sock.send(osc);
    for await (const frames of sock) {
      const bufs: Buffer[] = [];
      for (const f of frames) bufs.push(Buffer.from(f));
      return Buffer.concat(bufs);
    }
    return null;
  } finally { try { sock.close(); } catch { /* ok */ } }
}

async function sendOnce(ip: string, osc: Buffer): Promise<void> {
  const sock = new zmq.Dealer();
  await sock.connect(`tcp://${ip}:2002`);
  await new Promise((r) => setTimeout(r, 150));
  try { await sock.send(osc); }
  finally { try { sock.close(); } catch { /* ok */ } }
}

// ── msgpack helpers ──────────────────────────────────────────────────────────

function toFourCC(n: number): string {
  const chars = [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF];
  if (chars.every(c => c >= 32 && c < 127)) return chars.map(c => String.fromCharCode(c)).join("");
  return String(n);
}

function normalizeMsgpack(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(normalizeMsgpack);
  if (val !== null && typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      const n = Number(k);
      const key = Number.isInteger(n) && n >= 0 && String(n) === k ? toFourCC(n) : k;
      out[key] = normalizeMsgpack(v);
    }
    return out;
  }
  return val;
}

// Try to decode a blob as msgpack starting at various offsets.
// Returns { prefix, mpOffset, decoded } or null.
function tryDecodeBlobMsgpack(bytes: Buffer): { prefix: Buffer; mpOffset: number; decoded: unknown } | null {
  for (const off of [0, 4, 8, 12, 16]) {
    if (off >= bytes.length) break;
    try {
      const decoded = normalizeMsgpack(decode(bytes.slice(off)));
      return { prefix: bytes.slice(0, off), mpOffset: off, decoded };
    } catch { /* try next */ }
  }
  return null;
}

// ── GET: read a property ─────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ip   = searchParams.get("ip")   ?? "192.168.0.117";
  const path = searchParams.get("path") ?? "";
  if (!path) return Response.json({ ok: false, error: "missing path" }, { status: 400 });

  const osc = encodeOSC("/PropertyValueGet", "is", [1, path]);
  let replyBuf: Buffer | null;
  try { replyBuf = await queryOnce(ip, osc); }
  catch (err) { return Response.json({ ok: false, error: String(err) }, { status: 500 }); }
  if (!replyBuf) return Response.json({ ok: false, error: "no reply" }, { status: 504 });

  const osc2 = decodeOSC(replyBuf);
  if (!osc2) return Response.json({ ok: false, error: "OSC decode failed" }, { status: 500 });

  // args[0]=reqId  args[1]=path (echoed)  args[2]=value
  const rawArg = osc2.args[2];

  // If it's a blob, decode the msgpack inside.
  if (rawArg && typeof rawArg === "object" && "_b64" in (rawArg as Record<string, unknown>)) {
    const bArg = rawArg as { _b64: string; _len: number };
    if (bArg._len === 0) {
      return Response.json({ ok: true, path, typeTags: osc2.typeTags, value: null, valueType: null, blobPrefix: null });
    }
    const bytes = Buffer.from(bArg._b64, "base64");
    const result = tryDecodeBlobMsgpack(bytes);
    if (result) {
      const v = result.decoded as Record<string, unknown>;
      const cleanValue = v["val_"] ?? v["valu"] ?? null;
      const valueType  = v["type"] != null ? String(v["type"]) : null;
      const blobPrefix = result.prefix.length > 0 ? result.prefix.toString("hex") : null;
      return Response.json({
        ok: true, path, typeTags: osc2.typeTags,
        value: cleanValue, valueType, blobPrefix,
        raw: result.decoded,
      });
    }
    // Failed to decode — return hex for debugging
    return Response.json({
      ok: true, path, typeTags: osc2.typeTags,
      value: null, valueType: null, blobPrefix: null,
      raw: { _ok: false, _len: bArg._len, _hex: bytes.slice(0, 64).toString("hex") },
    });
  }

  // Scalar value (string/number/bool)
  return Response.json({ ok: true, path, typeTags: osc2.typeTags, value: rawArg, valueType: null, blobPrefix: null });
}

// ── POST: write a property ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let ip: string, path: string, value: string | number;
  try {
    const body = await req.json() as { ip?: string; path: string; value: string | number };
    ip    = body.ip    ?? "192.168.0.117";
    path  = body.path;
    value = body.value;
  } catch {
    return Response.json({ ok: false, error: "bad JSON" }, { status: 400 });
  }

  const isNum  = typeof value === "number" || (!isNaN(Number(value)) && String(value).trim() !== "");
  const numVal = isNum ? Number(value) : 0;

  // Step 1 — read current blob to extract the magic prefix bytes.
  let prefixBytes = Buffer.alloc(0);
  let useBlob = false;

  try {
    const readOsc = encodeOSC("/PropertyValueGet", "is", [1, path]);
    const readBuf = await queryOnce(ip, readOsc);
    if (readBuf) {
      const readDecoded = decodeOSC(readBuf);
      const rawArg = readDecoded?.args[2];
      if (rawArg && typeof rawArg === "object" && "_b64" in (rawArg as Record<string, unknown>)) {
        const bArg = rawArg as { _b64: string };
        const bytes = Buffer.from(bArg._b64, "base64");
        const result = tryDecodeBlobMsgpack(bytes);
        if (result) {
          prefixBytes = Buffer.from(result.prefix);
          useBlob = true;
        }
      }
    }
  } catch { /* send without blob format if read fails */ }

  // Step 2 — build OSC and send.
  let osc: Buffer;

  if (useBlob) {
    // Rebuild blob: [prefix bytes] + msgpack({ key_: path, type: "i"|"s", val_: value })
    const payload = encodeIntKeys({
      [K_KEY_]: path,
      [K_TYPE]: isNum ? "i" : "s",
      [K_VAL_]: isNum ? numVal : String(value),
    });
    const newBlob = Buffer.concat([prefixBytes, Buffer.from(payload)]);
    osc = encodePropertySet(path, newBlob);
  } else {
    // Fallback: scalar PropertyValueSet (isi or iss)
    const typeTags = isNum ? "isi" : "iss";
    const args: (number | string)[] = isNum ? [1, path, numVal] : [1, path, String(value)];
    osc = encodeOSC("/PropertyValueSet", typeTags, args);
  }

  try {
    await sendOnce(ip, osc);
    return Response.json({ ok: true, bytes: osc.length, path, value, useBlob });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
