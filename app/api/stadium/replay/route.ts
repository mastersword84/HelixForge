import { NextRequest } from "next/server";
import * as zmq from "zeromq";
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

// Re-encode a decoded blob arg back to binary.
// Handles {_magic, _msgpack} (8-byte prefix + msgpack), {_msgpack} (plain msgpack),
// {_b64} (base64 passthrough), and plain Buffer.
function reBlob(arg: unknown): Buffer {
  if (arg instanceof Buffer) return arg;
  if (arg && typeof arg === "object") {
    const a = arg as Record<string, unknown>;
    if ("_magic" in a && "_msgpack" in a) {
      const magic = Buffer.from(a._magic as string, "ascii");
      const payload = Buffer.from(encodeIntKeys(toNumericKeys(a._msgpack)));
      return Buffer.concat([magic, payload]);
    }
    if ("_msgpack" in a) {
      return Buffer.from(encodeIntKeys(toNumericKeys(a._msgpack)));
    }
    if ("_b64" in a) {
      return Buffer.from(a._b64 as string, "base64");
    }
  }
  return Buffer.alloc(0);
}

// Walk a decoded msgpack object and convert string-numeric keys back to numbers.
function toNumericKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(toNumericKeys);
  if (obj !== null && typeof obj === "object") {
    const out: Record<string | number, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const n = Number(k);
      const key = Number.isInteger(n) && String(n) === k ? n : k;
      out[key] = toNumericKeys(v);
    }
    return out;
  }
  return obj;
}

// Infer OSC type tag for a single arg.
function inferTag(arg: unknown): string {
  if (arg && typeof arg === "object" && (
    "_magic" in (arg as Record<string, unknown>) ||
    "_msgpack" in (arg as Record<string, unknown>) ||
    "_b64" in (arg as Record<string, unknown>)
  )) return "b";
  if (typeof arg === "string") return "s";
  if (typeof arg === "number") return Number.isInteger(arg) ? "i" : "f";
  return "i";
}

function encodeOSC(address: string, args: unknown[]): Buffer {
  const typeTags = args.map(inferTag).join("");
  const addrBuf = encodeStr(address);
  const tagBuf = encodeStr("," + typeTags);

  const argBufs: Buffer[] = [];
  for (let i = 0; i < args.length; i++) {
    const tag = typeTags[i];
    const arg = args[i];
    if (tag === "i") {
      const b = Buffer.alloc(4); b.writeInt32BE(arg as number); argBufs.push(b);
    } else if (tag === "f") {
      const b = Buffer.alloc(4); b.writeFloatBE(arg as number); argBufs.push(b);
    } else if (tag === "s") {
      argBufs.push(encodeStr(arg as string));
    } else if (tag === "b") {
      const blob = reBlob(arg);
      const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32BE(blob.length);
      const padded = Buffer.alloc(padTo4(blob.length));
      blob.copy(padded);
      argBufs.push(lenBuf, padded);
    }
  }
  return Buffer.concat([addrBuf, tagBuf, ...argBufs]);
}

let sender: zmq.Push | null = null;
let senderTarget = "";
let seqCounter = 0;

async function getSender(ip: string, port: string): Promise<zmq.Push> {
  const target = `tcp://${ip}:${port}`;
  if (sender && senderTarget === target) return sender;
  if (sender) { try { sender.close(); } catch { /* ok */ } sender = null; }
  sender = new zmq.Push();
  await sender.connect(target);
  senderTarget = target;
  await new Promise((r) => setTimeout(r, 200));
  return sender;
}

function resetSender() {
  if (sender) { try { sender.close(); } catch { /* ok */ } sender = null; senderTarget = ""; }
}

interface CapturedEvent {
  type: string;
  port?: string;
  topic?: string;
  data?: { args?: unknown[] };
}

export async function POST(req: NextRequest) {
  let ip: string, port: string, events: CapturedEvent[];
  try {
    const body = await req.json() as { ip?: string; port?: string; events: CapturedEvent[] };
    ip = body.ip ?? "192.168.0.117";
    port = body.port ?? "2002";
    events = body.events ?? [];
  } catch {
    return Response.json({ ok: false, error: "bad JSON" }, { status: 400 });
  }

  // Filter to port-2001 commands only; keep heartbeats (they may be required for session state)
  const commands = events.filter(
    (e) => e.type === "msg" && e.port === "2001"
  );

  if (commands.length === 0) {
    return Response.json({ ok: false, error: "no replayable commands" }, { status: 400 });
  }

  try {
    const sock = await getSender(ip, port);
    let sent = 0;

    for (const cmd of commands) {
      const args = cmd.data?.args ?? [];
      const osc = encodeOSC(cmd.topic!, args);
      seqCounter += 1;
      try {
        await sock.send(osc);
      } catch (sendErr) {
        resetSender();
        return Response.json({ ok: false, error: `send failed at cmd ${sent}: ${String(sendErr)}` }, { status: 500 });
      }
      sent++;
      await new Promise((r) => setTimeout(r, 50));
    }

    return Response.json({ ok: true, sent, total: events.length });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
