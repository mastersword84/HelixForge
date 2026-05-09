import { NextRequest } from "next/server";
import * as zmq from "zeromq";
import { decode } from "@msgpack/msgpack";
import { encodeIntKeys } from "@/lib/stadium/msgpack-int-keys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function padTo4(len: number) { return Math.ceil(len / 4) * 4; }

function encodeStr(s: string): Buffer {
  const bytes = Buffer.from(s + "\x00", "utf8");
  const padded = Buffer.alloc(padTo4(bytes.length));
  bytes.copy(padded);
  return padded;
}

function encodeOSCi(address: string, reqId: number): Buffer {
  const addrBuf = encodeStr(address);
  const tagBuf  = encodeStr(",i");
  const argBuf  = Buffer.alloc(4); argBuf.writeInt32BE(reqId);
  return Buffer.concat([addrBuf, tagBuf, argBuf]);
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
    const address  = readStr();
    const tagStr   = readStr();
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

// Build /EditBufferStateSet ,ib [reqId, blob]
function encodeEditBufferSet(reqId: number, blob: Buffer): Buffer {
  const addrBuf = encodeStr("/EditBufferStateSet");
  const tagBuf  = encodeStr(",ib");
  const reqBuf  = Buffer.alloc(4); reqBuf.writeInt32BE(reqId);
  const lenBuf  = Buffer.alloc(4); lenBuf.writeUInt32BE(blob.length);
  const padded  = Buffer.alloc(padTo4(blob.length)); blob.copy(padded);
  return Buffer.concat([addrBuf, tagBuf, reqBuf, lenBuf, padded]);
}

// Convert a normalized 4-char FourCC string key back to its uint32 number.
// Used to re-encode JSON with string keys back into msgpack with integer keys.
function fourCCToInt(s: string): number | null {
  if (s.length !== 4) return null;
  const codes = [...s].map(c => c.charCodeAt(0));
  if (!codes.every(c => c >= 32 && c < 127)) return null;
  return (codes[0] << 24) | (codes[1] << 16) | (codes[2] << 8) | codes[3];
}

// Recursively convert FourCC string keys back to numeric integer keys for msgpack encoding.
function denormalize(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(denormalize);
  if (val !== null && typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      const n = fourCCToInt(k);
      const key = n !== null ? String(n) : k;
      out[key] = denormalize(v);
    }
    return out;
  }
  return val;
}

// Convert uint32 FourCC key to its 4-char ASCII string if all bytes are printable.
function toFourCC(n: number): string {
  const chars = [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF];
  if (chars.every(c => c >= 32 && c < 127)) return chars.map(c => String.fromCharCode(c)).join("");
  return `0x${n.toString(16).padStart(8, "0")}`;
}

// Recursively convert integer msgpack keys to FourCC strings.
// Truncates arrays > maxArr and strings > maxStr to keep JSON manageable.
function normalize(val: unknown, depth = 0): unknown {
  if (depth > 12) return "<deep>";
  if (Array.isArray(val)) {
    const slice = val.slice(0, 64).map(v => normalize(v, depth + 1));
    return val.length > 64 ? [...slice, `…+${val.length - 64} more`] : slice;
  }
  if (val instanceof Uint8Array || val instanceof Buffer) {
    return `<bin ${val.length}b: ${Buffer.from(val).slice(0, 16).toString("hex")}…>`;
  }
  if (val !== null && typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      const n = Number(k);
      const key = Number.isInteger(n) && n >= 0 && String(n) === k ? toFourCC(n) : k;
      out[key] = normalize(v, depth + 1);
    }
    return out;
  }
  if (typeof val === "string" && val.length > 200) return val.slice(0, 200) + "…";
  return val;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ip = searchParams.get("ip") ?? "192.168.0.117";

  const osc = encodeOSCi("/EditBufferStateGet", 1);

  let replyBuf: Buffer | null;
  try { replyBuf = await queryOnce(ip, osc); }
  catch (err) { return Response.json({ ok: false, error: String(err) }, { status: 500 }); }
  if (!replyBuf) return Response.json({ ok: false, error: "no reply" }, { status: 504 });

  const oscDecoded = decodeOSC(replyBuf);
  if (!oscDecoded) return Response.json({ ok: false, error: "OSC decode failed" }, { status: 500 });

  // typeTags = "ihb":  args[0]=reqId  args[1]=presetCid(h)  args[2]=blob(b)
  const presetCid = oscDecoded.args[1] as number;
  const blobArg   = oscDecoded.args[2] as { _b64?: string; _len?: number } | null | undefined;

  if (!blobArg?._b64 || !blobArg._len) {
    return Response.json({ ok: false, error: "empty blob", presetCid });
  }

  const blobBytes = Buffer.from(blobArg._b64, "base64");

  // Try decoding as msgpack at several offsets.
  for (const off of [0, 4, 8, 12, 16]) {
    if (off >= blobBytes.length) break;
    try {
      const raw = decode(blobBytes.slice(off));
      const normalized = normalize(raw);
      return Response.json({
        ok: true,
        presetCid,
        blobLen: blobArg._len,
        msgpackOffset: off,
        prefix: off > 0 ? blobBytes.slice(0, off).toString("hex") : null,
        rawBlob: blobArg._b64,  // raw blob for round-trip write
        data: normalized,
      });
    } catch { /* try next offset */ }
  }

  // Not msgpack — return raw hex so we can see the format.
  return Response.json({
    ok: false,
    presetCid,
    blobLen: blobArg._len,
    error: "not msgpack at any offset",
    hex64: blobBytes.slice(0, 64).toString("hex"),
    ascii16: blobBytes.slice(0, 16).toString("ascii").replace(/[^\x20-\x7e]/g, "."),
  });
}

// ── POST: write edit buffer back to device ───────────────────────────────────
// Body: { ip?, rawBlob?: string (base64 round-trip), data?: unknown (re-encode from normalized JSON) }

export async function POST(req: NextRequest) {
  let ip: string, rawBlob: string | undefined, data: unknown | undefined;
  try {
    const body = await req.json() as { ip?: string; rawBlob?: string; data?: unknown };
    ip      = body.ip    ?? "192.168.0.117";
    rawBlob = body.rawBlob;
    data    = body.data;
  } catch {
    return Response.json({ ok: false, error: "bad JSON" }, { status: 400 });
  }

  let blob: Buffer;

  if (rawBlob) {
    // Round-trip: use the raw bytes received from the device unchanged.
    blob = Buffer.from(rawBlob, "base64");
  } else if (data !== undefined) {
    // Re-encode: read current blob to extract magic prefix, then re-pack from normalized JSON.
    const readOsc = encodeOSCi("/EditBufferStateGet", 1);
    let prefix = Buffer.alloc(8);  // default 8-byte zero prefix
    try {
      const replyBuf = await queryOnce(ip, readOsc);
      if (replyBuf) {
        const osc = decodeOSC(replyBuf);
        const bArg = osc?.args[2] as { _b64?: string } | undefined;
        if (bArg?._b64) {
          const bytes = Buffer.from(bArg._b64, "base64");
          for (const off of [8, 4, 12, 16]) {
            try { decode(bytes.slice(off)); prefix = bytes.slice(0, off); break; } catch { /* next */ }
          }
        }
      }
    } catch { /* use zero prefix */ }
    const denorm = denormalize(data);
    const mp = Buffer.from(encodeIntKeys(denorm));
    blob = Buffer.concat([prefix, mp]);
  } else {
    return Response.json({ ok: false, error: "provide rawBlob or data" }, { status: 400 });
  }

  const osc = encodeEditBufferSet(1, blob);
  try {
    // Try with reply first (some commands echo back); fall back to fire-and-forget.
    let reply: ReturnType<typeof decodeOSC> | null = null;
    try {
      const replyBuf = await queryOnce(ip, osc);
      if (replyBuf) reply = decodeOSC(replyBuf);
    } catch {
      await sendOnce(ip, osc);
    }
    return Response.json({ ok: true, bytes: osc.length, blobBytes: blob.length, reply });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
