import { NextRequest } from "next/server";
import * as zmq from "zeromq";
import { decode } from "@msgpack/msgpack";
import { encodeIntKeys } from "@/lib/stadium/msgpack-int-keys";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── OSC helpers (shared pattern) ────────────────────────────────────────────

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

function encodeOSCi(address: string, reqId: number): Buffer {
  const addrBuf = encodeStr(address);
  const tagBuf  = encodeStr(",i");
  const argBuf  = Buffer.alloc(4); argBuf.writeInt32BE(reqId);
  return Buffer.concat([addrBuf, tagBuf, argBuf]);
}

function encodeEditBufferSet(reqId: number, blob: Buffer): Buffer {
  const addrBuf = encodeStr("/EditBufferStateSet");
  const tagBuf  = encodeStr(",ib");
  const reqBuf  = Buffer.alloc(4); reqBuf.writeInt32BE(reqId);
  const lenBuf  = Buffer.alloc(4); lenBuf.writeUInt32BE(blob.length);
  const padded  = Buffer.alloc(padTo4(blob.length)); blob.copy(padded);
  return Buffer.concat([addrBuf, tagBuf, reqBuf, lenBuf, padded]);
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

async function queryOnce(ip: string, osc: Buffer, timeoutMs = 4000): Promise<Buffer | null> {
  const sock = new zmq.Dealer();
  await sock.connect(`tcp://${ip}:2002`);
  await new Promise((r) => setTimeout(r, 150));
  const timer = setTimeout(() => { try { sock.close(); } catch { /* ok */ } }, timeoutMs);
  try {
    await sock.send(osc);
    for await (const frames of sock) {
      clearTimeout(timer);
      const bufs: Buffer[] = [];
      for (const f of frames) bufs.push(Buffer.from(f));
      return Buffer.concat(bufs);
    }
    return null;
  } finally { clearTimeout(timer); try { sock.close(); } catch { /* ok */ } }
}

// ── Preset browser search ───────────────────────────────────────────────────

interface PresetEntry { name: string; cid: number; }

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

function extractPresets(decoded: unknown): PresetEntry[] {
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
    const name = (e["name"] ?? e["nam_"] ?? "") as string;
    const cidVal = e["cid_"] ?? e["cid "] ?? e["CID_"];
    if (typeof name === "string" && name.length > 0 && typeof cidVal === "number") {
      return [{ name, cid: cidVal }];
    }
    const vals = Object.values(e);
    const nameGuess = vals.find(v => typeof v === "string" && (v as string).length > 0) as string | undefined;
    const cidGuess = vals.find(v => typeof v === "number" && Number.isInteger(v)) as number | undefined;
    if (nameGuess !== undefined || cidGuess !== undefined) {
      return [{ name: nameGuess ?? "", cid: cidGuess ?? -1 }];
    }
    return [];
  });
}

async function findPresetCid(ip: string, targetName: string): Promise<number | null> {
  // Search factory CID (-1) for the preset
  const osc = encodeOSCii("/GetContainerContents", 1, -1);
  try {
    const buf = await queryOnce(ip, osc);
    if (!buf) return null;
    const dec = decodeOSC(buf);
    const blobArg = dec?.args[1] as { _b64?: string } | undefined;
    if (!blobArg?._b64) return null;
    const bytes = Buffer.from(blobArg._b64, "base64");
    const raw = decode(bytes);
    const presets = extractPresets(normalizeMsgpack(raw));
    const target = targetName.trim().toLowerCase();
    const match = presets.find(p => p.name.trim().toLowerCase() === target);
    return match?.cid ?? null;
  } catch { return null; }
}

// ── msgpack blob encode/decode ───────────────────────────────────────────────

function fourCCToInt(s: string): number | null {
  if (s.length !== 4) return null;
  const codes = [...s].map(c => c.charCodeAt(0));
  if (!codes.every(c => c >= 32 && c < 127)) return null;
  return (codes[0] << 24) | (codes[1] << 16) | (codes[2] << 8) | codes[3];
}

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

async function readEditBuffer(ip: string): Promise<{ prefix: Buffer; data: Record<string, unknown>; rawB64: string } | null> {
  const osc = encodeOSCi("/EditBufferStateGet", 1);
  const buf = await queryOnce(ip, osc);
  if (!buf) return null;
  const dec = decodeOSC(buf);
  const blobArg = dec?.args[2] as { _b64?: string; _len?: number } | undefined;
  if (!blobArg?._b64 || !blobArg._len) return null;

  const bytes = Buffer.from(blobArg._b64, "base64");
  for (const off of [0, 4, 8, 12, 16]) {
    if (off >= bytes.length) break;
    try {
      const raw = decode(bytes.slice(off)) as Record<string, unknown>;
      const data = normalizeMsgpack(raw) as Record<string, unknown>;
      return { prefix: bytes.slice(0, off), data, rawB64: blobArg._b64 };
    } catch { /* try next */ }
  }
  return null;
}

function writeEditBuffer(prefix: Buffer, data: Record<string, unknown>): Buffer {
  const denorm = denormalize(data);
  const mp = Buffer.from(encodeIntKeys(denorm));
  return Buffer.concat([prefix, mp]);
}

// ── Snapshot name patcher ───────────────────────────────────────────────────

interface SnapshotDecision { name: string; tempo?: number | null; }

function patchSnapshotNames(data: Record<string, unknown>, snapshots: SnapshotDecision[]): void {
  try {
    const cg = data["cg__"] as Record<string, unknown> | undefined;
    const entt = cg?.["entt"] as Record<string, unknown> | undefined;
    const snps = entt?.["snps"] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(snps)) return;
    for (const snap of snps) {
      const idx = Number(snap["si__"] ?? -1);
      if (idx >= 0 && idx < snapshots.length && snapshots[idx]?.name) {
        snap["name"] = snapshots[idx].name;
      }
    }
  } catch { /* non-fatal */ }
}

// ── Stomp label patcher ──────────────────────────────────────────────────────

interface StompDecision { slot: number; label: string; color?: number; }

function patchStompLabels(data: Record<string, unknown>, stomps: StompDecision[]): void {
  try {
    const pm = data["pm__"] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(pm)) return;
    for (const stomp of stomps) {
      const labelKey = `preset.floorboard.stomp.a.${stomp.slot}.label`;
      const colorKey = `preset.floorboard.stomp.a.${stomp.slot}.color`;
      let labelEntry = pm.find(e => e["key_"] === labelKey);
      if (!labelEntry) {
        labelEntry = { "key_": labelKey, "type": "s", "val_": "" };
        pm.push(labelEntry);
      }
      labelEntry["val_"] = stomp.label;
      if (stomp.color != null) {
        let colorEntry = pm.find(e => e["key_"] === colorKey);
        if (!colorEntry) {
          colorEntry = { "key_": colorKey, "type": "i", "val_": 1 };
          pm.push(colorEntry);
        }
        colorEntry["val_"] = stomp.color;
      }
    }
  } catch { /* non-fatal */ }
}

// ── Library preset loader ──────────────────────────────────────────────────

async function readFromLibrary(libraryPresetId: string): Promise<{
  prefix: Buffer; data: Record<string, unknown>; rawB64: string;
} | null> {
  try {
    const { data: row, error } = await supabaseAdmin
      .from("helixforge_presets")
      .select("hsp")
      .eq("id", libraryPresetId)
      .single();
    if (error || !row) return null;
    const hsp = row.hsp as { blob_b64?: string; prefix_b64?: string } | undefined;
    if (!hsp?.blob_b64) return null;
    const bytes = Buffer.from(hsp.blob_b64, "base64");
    const prefix = hsp.prefix_b64 ? Buffer.from(hsp.prefix_b64, "base64") : Buffer.alloc(0);
    const off = prefix.length;
    const raw = decode(bytes.slice(off)) as Record<string, unknown>;
    const data = normalizeMsgpack(raw) as Record<string, unknown>;
    return { prefix, data, rawB64: hsp.blob_b64 };
  } catch { return null; }
}

// ── POST handler ─────────────────────────────────────────────────────────────
//
// Body: {
//   ip?: string
//   basePresetName?: string         — name of factory preset to load first
//   libraryPresetId?: string        — UUID of a captured library preset to use as base
//   snapshots?: SnapshotDecision[]  — names to apply to snapshots 0-7
//   stomps?: StompDecision[]        — stomp labels + colors to write
//   skipLoad?: boolean              — if true, patch whatever is currently loaded
// }

export async function POST(req: NextRequest) {
  let ip: string, basePresetName: string, libraryPresetId: string | undefined;
  let snapshots: SnapshotDecision[], stomps: StompDecision[], skipLoad: boolean;
  try {
    const body = await req.json() as {
      ip?: string;
      basePresetName?: string;
      libraryPresetId?: string;
      snapshots?: SnapshotDecision[];
      stomps?: StompDecision[];
      skipLoad?: boolean;
    };
    ip = body.ip ?? "192.168.0.117";
    basePresetName = body.basePresetName ?? "";
    libraryPresetId = body.libraryPresetId;
    snapshots = Array.isArray(body.snapshots) ? body.snapshots : [];
    stomps = Array.isArray(body.stomps) ? body.stomps : [];
    skipLoad = body.skipLoad ?? false;
  } catch {
    return Response.json({ ok: false, error: "bad JSON" }, { status: 400 });
  }

  const log: string[] = [];

  // Step 1: Get the base edit buffer
  let buf: Awaited<ReturnType<typeof readEditBuffer>>;

  if (libraryPresetId) {
    // Load from library (Supabase captured preset) — no device interaction needed
    const libBuf = await readFromLibrary(libraryPresetId);
    if (!libBuf) {
      return Response.json({ ok: false, error: `Library preset ${libraryPresetId} not found or has no blob`, log }, { status: 404 });
    }
    buf = libBuf;
    log.push(`Loaded library preset from Supabase (${Buffer.from(libBuf.rawB64, "base64").length}b)`);
  } else {
    // Load from device (factory preset or current edit buffer)
    if (!skipLoad && basePresetName) {
      const cid = await findPresetCid(ip, basePresetName);
      if (cid == null) {
        log.push(`Base preset "${basePresetName}" not found in factory browser — patching current preset instead`);
      } else {
        log.push(`Found "${basePresetName}" → CID ${cid}`);
        const loadOsc = encodeOSCii("/LoadPresetWithCID", 1, cid);
        await queryOnce(ip, loadOsc);
        await new Promise(r => setTimeout(r, 500));
        log.push("Preset loaded to device");
      }
    } else if (skipLoad) {
      log.push("skipLoad=true — patching currently loaded preset");
    }
    buf = await readEditBuffer(ip);
  }

  if (!buf) return Response.json({ ok: false, error: "failed to read edit buffer", log }, { status: 500 });
  log.push(`Edit buffer ready: ${buf.prefix.length}b prefix`);

  // Step 3: Patch snapshot names
  if (snapshots.length > 0) {
    patchSnapshotNames(buf.data, snapshots);
    log.push(`Patched ${snapshots.length} snapshot names`);
  }

  // Step 4: Patch stomp labels
  if (stomps.length > 0) {
    patchStompLabels(buf.data, stomps);
    log.push(`Patched ${stomps.length} stomp labels`);
  }

  // Step 5: Re-encode and write back
  const newBlob = writeEditBuffer(buf.prefix, buf.data);
  const setOsc = encodeEditBufferSet(1, newBlob);
  try {
    const reply = await queryOnce(ip, setOsc);
    const decReply = reply ? decodeOSC(reply) : null;
    log.push(`EditBufferStateSet sent: ${newBlob.length}b`);
    return Response.json({ ok: true, blobBytes: newBlob.length, reply: decReply, log });
  } catch (err) {
    return Response.json({ ok: false, error: String(err), log }, { status: 500 });
  }
}
