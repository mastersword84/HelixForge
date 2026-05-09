import { NextRequest } from "next/server";
import * as zmq from "zeromq";
import { decode } from "@msgpack/msgpack";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── OSC helpers ────────────────────────────────────────────────────────────

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

async function readEditBuffer(ip: string): Promise<{
  prefix: Buffer;
  data: Record<string, unknown>;
  rawB64: string;
  presetCid: number | null;
} | null> {
  const osc = encodeOSCi("/EditBufferStateGet", 1);
  const buf = await queryOnce(ip, osc);
  if (!buf) return null;
  const dec = decodeOSC(buf);
  const presetCid = dec?.args[1] != null ? Number(dec.args[1]) : null;
  const blobArg = dec?.args[2] as { _b64?: string; _len?: number } | undefined;
  if (!blobArg?._b64 || !blobArg._len) return null;

  const bytes = Buffer.from(blobArg._b64, "base64");
  for (const off of [0, 4, 8, 12, 16]) {
    if (off >= bytes.length) break;
    try {
      const raw = decode(bytes.slice(off)) as Record<string, unknown>;
      const data = normalizeMsgpack(raw) as Record<string, unknown>;
      return { prefix: bytes.slice(0, off), data, rawB64: blobArg._b64, presetCid };
    } catch { /* try next */ }
  }
  return null;
}

// ── Data extraction ────────────────────────────────────────────────────────

function extractSnapshots(data: Record<string, unknown>): Array<{ name: string; index: number }> {
  try {
    const cg = data["cg__"] as Record<string, unknown> | undefined;
    const entt = cg?.["entt"] as Record<string, unknown> | undefined;
    const snps = entt?.["snps"] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(snps)) return [];
    return snps
      .filter(s => s && typeof s === "object")
      .map(s => ({ name: String(s["name"] ?? ""), index: Number(s["si__"] ?? 0) }))
      .sort((a, b) => a.index - b.index)
      .filter(s => s.name);
  } catch { return []; }
}

function extractStomps(data: Record<string, unknown>): Array<{ slot: number; label: string; color: number }> {
  try {
    const pm = data["pm__"] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(pm)) return [];
    return pm
      .filter(e => typeof e["key_"] === "string" && /^preset\.floorboard\.stomp\.a\.\d+\.label$/.test(e["key_"] as string))
      .flatMap(e => {
        const key = e["key_"] as string;
        const m = key.match(/\.(\d+)\.label$/);
        if (!m) return [];
        const slot = parseInt(m[1], 10);
        const label = String(e["val_"] ?? "");
        if (!label) return [];
        const colorKey = `preset.floorboard.stomp.a.${slot}.color`;
        const colorEntry = pm.find(ce => ce["key_"] === colorKey);
        return [{ slot, label, color: colorEntry ? Number(colorEntry["val_"] ?? 0) : 0 }];
      });
  } catch { return []; }
}

function extractChain(data: Record<string, unknown>): string[] {
  try {
    const sfg = data["sfg_"] as Record<string, unknown> | undefined;
    const flow = sfg?.["flow"] as unknown[] | undefined;
    if (!Array.isArray(flow) || !flow[0]) return [];
    const path0 = flow[0] as Record<string, unknown>;
    const blks = path0["blks"] as unknown[] | undefined;
    if (!Array.isArray(blks)) return [];
    const names: string[] = [];
    for (let i = 1; i < blks.length; i += 2) {
      const b = blks[i] as Record<string, unknown>;
      const mdls = b["mdls"] as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(mdls) && mdls.length > 0) {
        const mid = mdls[0]["id__"];
        if (mid != null) names.push(`mid:${mid}`);
      }
    }
    return names;
  } catch { return []; }
}

// ── POST handler ───────────────────────────────────────────────────────────
//
// Body: { ip?, presetName, description? }
// Reads the current edit buffer from the device and saves it to the
// helixforge_presets library with full blob data for later replay.

export async function POST(req: NextRequest) {
  let ip: string, presetName: string, description: string;
  try {
    const body = await req.json() as { ip?: string; presetName?: string; description?: string };
    ip = body.ip ?? "192.168.0.117";
    presetName = (body.presetName ?? "Captured Preset").trim();
    description = (body.description ?? "").trim();
  } catch {
    return Response.json({ ok: false, error: "bad JSON" }, { status: 400 });
  }

  const buf = await readEditBuffer(ip);
  if (!buf) {
    return Response.json({ ok: false, error: "failed to read edit buffer — is the device connected?" }, { status: 500 });
  }

  const snapshots = extractSnapshots(buf.data);
  const stomps = extractStomps(buf.data);
  const chain = extractChain(buf.data);

  const { data: row, error } = await supabaseAdmin
    .from("helixforge_presets")
    .insert({
      mode: "capture",
      preset_name: presetName,
      description: description || `Captured from device — ${new Date().toLocaleString()}`,
      chain,
      snapshots: snapshots.map(s => s.name),
      sections: null,
      midi_info: null,
      hsp: {
        source: "device-capture",
        blob_b64: buf.rawB64,
        prefix_b64: buf.prefix.toString("base64"),
        preset_cid: buf.presetCid,
        snapshot_detail: snapshots,
        stomp_detail: stomps,
        captured_at: new Date().toISOString(),
      },
    })
    .select("id")
    .single();

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  return Response.json({
    ok: true,
    id: row.id,
    presetName,
    snapshotCount: snapshots.length,
    stompCount: stomps.length,
    chainBlocks: chain.length,
    blobBytes: Buffer.from(buf.rawB64, "base64").length,
    snapshots: snapshots.map(s => s.name),
  });
}
