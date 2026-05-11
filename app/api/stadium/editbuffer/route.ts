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

// Non-truncating key normalizer — converts integer msgpack keys to FourCC only.
// Used for data extraction (stomps, etc.) where truncation would drop entries.
function normalizeKeys(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(normalizeKeys);
  if (val instanceof Uint8Array || val instanceof Buffer) return null;
  if (val !== null && typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      const n = Number(k);
      const key = Number.isInteger(n) && n >= 0 && String(n) === k ? toFourCC(n) : k;
      out[key] = normalizeKeys(v);
    }
    return out;
  }
  return val;
}

export interface StompEntry { slot: number; label: string; color: number; }

// Stomp source IDs (same as HSP sources keys).
// Bank A: 0x01010100 – 0x0101010B → display slots 1-12
// Bank B: 0x01010200 – 0x0101020B → display slots 13-24
const STOMP_A_BASE = 0x01010100;
const STOMP_B_BASE = 0x01010200;
const STOMP_BANK_SIZE = 12;

const COLOR_NAMES: Record<string, number> = {
  auto: 0, white: 0, red: 1, orange: 2, yellow: 3, green: 4,
  cyan: 5, blue: 6, violet: 7, pink: 8, aqua: 9, lime: 10, mint: 11,
};

function parseColor(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").toLowerCase().trim();
  return COLOR_NAMES[s] ?? 0;
}

// Walk the full normalized blob looking for hex-keyed source objects.
// After normalizeKeys, non-printable integer keys become "0x01010100" etc.
function extractStomps(raw: unknown): { stomps: StompEntry[]; sampleSource: Record<string, unknown> | null } {
  const norm = normalizeKeys(raw) as Record<string, unknown>;
  const slotMap = new Map<number, { label: string; color: number }>();
  let sampleSource: Record<string, unknown> | null = null;

  function walk(obj: Record<string, unknown>) {
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("0x")) {
        const n = parseInt(k, 16);
        let slot: number | null = null;
        if (n >= STOMP_A_BASE && n < STOMP_A_BASE + STOMP_BANK_SIZE) {
          slot = (n - STOMP_A_BASE) + 1;       // 1-12
        } else if (n >= STOMP_B_BASE && n < STOMP_B_BASE + STOMP_BANK_SIZE) {
          slot = (n - STOMP_B_BASE) + 1 + 12;  // 13-24
        }
        if (slot !== null && v && typeof v === "object" && !Array.isArray(v)) {
          const src = v as Record<string, unknown>;
          if (!sampleSource) sampleSource = src; // capture first found for diagnosis
          const label = String(
            src["fs_l"] ?? src["labl"] ?? src["name"] ?? src["lbl_"] ?? src["fs_label"] ?? ""
          );
          const color = parseColor(
            src["fs_c"] ?? src["colr"] ?? src["clr_"] ?? src["fs_color"] ?? 0
          );
          slotMap.set(slot, { label, color });
        }
      }
      if (v && typeof v === "object" && !Array.isArray(v)) {
        walk(v as Record<string, unknown>);
      }
    }
  }

  walk(norm);

  // Supplement from pm__ — scan all values in each entry for stomp path strings.
  const pm = norm["pm__"];
  if (Array.isArray(pm)) {
    for (const entry of pm) {
      if (!entry || typeof entry !== "object") continue;
      const allVals = Object.values(entry as Record<string, unknown>);
      const keyStr = allVals.find(
        (v): v is string => typeof v === "string" &&
          /preset\.floorboard\.stomp\.(a|b)\.\d+\.(label|color)/.test(v)
      );
      if (!keyStr) continue;
      const m = keyStr.match(/preset\.floorboard\.stomp\.(a|b)\.(\d+)\.(label|color)/);
      if (!m) continue;
      const slot = parseInt(m[2], 10) + (m[1] === "b" ? 12 : 0);
      const valRaw = allVals.find(v => v !== keyStr);
      const cur = slotMap.get(slot) ?? { label: "", color: 0 };
      if (m[3] === "label" && !cur.label) cur.label = String(valRaw ?? "");
      if (m[3] === "color" && cur.color === 0) cur.color = parseColor(valRaw);
      slotMap.set(slot, cur);
    }
  }

  return {
    stomps: Array.from(slotMap.entries()).map(([slot, v]) => ({ slot, ...v })),
    sampleSource,
  };
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
      const { stomps, sampleSource } = extractStomps(raw);
      const normFull = normalizeKeys(raw) as Record<string, unknown>;
      const topKeys = Object.keys(normFull);
      return Response.json({
        ok: true,
        presetCid,
        blobLen: blobArg._len,
        msgpackOffset: off,
        prefix: off > 0 ? blobBytes.slice(0, off).toString("hex") : null,
        rawBlob: blobArg._b64,
        stomps,
        stompDebug: { topKeys, stompCount: stomps.length, sampleSource },
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
