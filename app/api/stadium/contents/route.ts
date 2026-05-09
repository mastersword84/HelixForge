import { NextRequest } from "next/server";
import * as zmq from "zeromq";
import { decode } from "@msgpack/msgpack";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── OSC helpers ─────────────────────────────────────────────────────────────

function padTo4(len: number) { return Math.ceil(len / 4) * 4; }

function encodeStr(s: string): Buffer {
  const bytes = Buffer.from(s + "\x00", "utf8");
  const padded = Buffer.alloc(padTo4(bytes.length));
  bytes.copy(padded);
  return padded;
}

function encodeOSCii(address: string, a: number, b: number): Buffer {
  const addrBuf = encodeStr(address);
  const tagBuf  = encodeStr(",ii");
  const aB = Buffer.alloc(4); aB.writeInt32BE(a);
  const bB = Buffer.alloc(4); bB.writeInt32BE(b);
  return Buffer.concat([addrBuf, tagBuf, aB, bB]);
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

async function queryOnce(ip: string, port: string, osc: Buffer): Promise<Buffer | null> {
  const sock = new zmq.Dealer();
  await sock.connect(`tcp://${ip}:${port}`);
  await new Promise((r) => setTimeout(r, 150));
  try {
    await sock.send(osc);
    for await (const frames of sock) {
      const bufs: Buffer[] = [];
      for (const f of frames) bufs.push(Buffer.from(f));
      return Buffer.concat(bufs);
    }
    return null;
  } finally {
    try { sock.close(); } catch { /* ok */ }
  }
}

// ── msgpack normalization ────────────────────────────────────────────────────

// Convert a uint32 FourCC key to its 4-char ASCII string if printable.
function toFourCC(n: number): string {
  const chars = [
    (n >>> 24) & 0xFF,
    (n >>> 16) & 0xFF,
    (n >>> 8)  & 0xFF,
     n         & 0xFF,
  ];
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

// ── preset extraction ────────────────────────────────────────────────────────

export interface PresetEntry {
  name: string;
  cid: number;
}

function extractPresets(decoded: unknown): PresetEntry[] {
  // Top-level might be an array of entries, or an object containing one.
  let arr: unknown[] | null = null;
  if (Array.isArray(decoded)) {
    arr = decoded;
  } else if (decoded !== null && typeof decoded === "object") {
    for (const v of Object.values(decoded as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length > 0) { arr = v; break; }
    }
  }
  if (!arr) return [];

  return arr.flatMap((entry): PresetEntry[] => {
    if (!entry || typeof entry !== "object") return [];
    const e = entry as Record<string, unknown>;

    // Known FourCC keys for name and CID
    const name = (e["name"] ?? e["nam_"] ?? "") as string;
    const cidVal = e["cid_"] ?? e["cid "] ?? e["CID_"];

    if (typeof name === "string" && name.length > 0 && typeof cidVal === "number") {
      return [{ name, cid: cidVal }];
    }

    // Fallback: find first string value and first positive-integer value
    const vals = Object.values(e);
    const nameGuess = vals.find(v => typeof v === "string" && (v as string).length > 0) as string | undefined;
    const cidGuess = vals.find(v => typeof v === "number" && Number.isInteger(v as number)) as number | undefined;

    if (nameGuess !== undefined || cidGuess !== undefined) {
      return [{ name: nameGuess ?? "", cid: cidGuess ?? -1 }];
    }
    return [];
  });
}

// ── route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ip  = searchParams.get("ip")  ?? "192.168.0.117";
  const cid = parseInt(searchParams.get("cid") ?? "-1", 10);

  const osc = encodeOSCii("/GetContainerContents", 1, cid);

  let replyBuf: Buffer | null;
  try {
    replyBuf = await queryOnce(ip, "2002", osc);
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }

  if (!replyBuf) {
    return Response.json({ ok: false, error: "no reply from device" }, { status: 504 });
  }

  const oscDecoded = decodeOSC(replyBuf);
  if (!oscDecoded) {
    return Response.json({ ok: false, error: "OSC decode failed" }, { status: 500 });
  }

  const count    = (oscDecoded.args[2] as number) ?? 0;
  const blobArg  = oscDecoded.args[1] as { _b64?: string; _len?: number } | null | undefined;
  const blobB64  = blobArg?._b64;
  const blobLen  = blobArg?._len ?? 0;

  if (!blobB64 || blobLen === 0) {
    return Response.json({ ok: true, presets: [], count, raw: null });
  }

  try {
    const blobBytes  = Buffer.from(blobB64, "base64");
    const mpRaw      = decode(blobBytes);
    const normalized = normalizeMsgpack(mpRaw);
    const presets    = extractPresets(normalized);
    return Response.json({ ok: true, presets, count, raw: normalized });
  } catch (err) {
    return Response.json({ ok: true, presets: [], count, error: String(err), raw: null });
  }
}
