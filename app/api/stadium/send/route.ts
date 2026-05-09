import { NextRequest } from "next/server";
import * as zmq from "zeromq";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function padTo4(len: number) { return Math.ceil(len / 4) * 4; }
function encodeStr(s: string): Buffer {
  const bytes = Buffer.from(s + "\x00", "utf8");
  const padded = Buffer.alloc(padTo4(bytes.length));
  bytes.copy(padded);
  return padded;
}

function encodeOSC(address: string, typeTags: string, args: (number | string | Buffer)[]): Buffer {
  const addrBuf = encodeStr(address);
  const tagBuf  = encodeStr("," + typeTags);

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
      const blob = arg as Buffer;
      const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32BE(blob.length);
      const padded = Buffer.alloc(padTo4(blob.length));
      blob.copy(padded);
      argBufs.push(lenBuf, padded);
    }
  }
  return Buffer.concat([addrBuf, tagBuf, ...argBufs]);
}

// Decode an OSC buffer into { address, typeTags, args[] }
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
    const tagStr = readStr(); // e.g. ",ii"
    const typeTags = tagStr.startsWith(",") ? tagStr.slice(1) : tagStr;

    const args: unknown[] = [];
    for (const tag of typeTags) {
      if (tag === "i") {
        args.push(buf.readInt32BE(offset)); offset += 4;
      } else if (tag === "h") {
        const hi = BigInt(buf.readInt32BE(offset));
        const lo = BigInt(buf.readUInt32BE(offset + 4));
        args.push(Number((hi << BigInt(32)) | lo));
        offset += 8;
      } else if (tag === "f") {
        args.push(buf.readFloatBE(offset)); offset += 4;
      } else if (tag === "d") {
        args.push(buf.readDoubleBE(offset)); offset += 8;
      } else if (tag === "s") {
        args.push(readStr());
      } else if (tag === "b") {
        const len = buf.readUInt32BE(offset); offset += 4;
        args.push({ _b64: buf.slice(offset, offset + len).toString("base64"), _len: len });
        offset += padTo4(len);
      } else if (tag === "T") {
        args.push(true);
      } else if (tag === "F") {
        args.push(false);
      } else if (tag === "N") {
        args.push(null);
      } else {
        args.push(`<${tag}?>`);
      }
    }
    return { address, typeTags, args };
  } catch {
    return null;
  }
}

// Fire-and-forget socket (reused, no reply reading)
let sender: zmq.Dealer | null = null;
let senderTarget = "";

async function getSender(ip: string, port: string): Promise<zmq.Dealer> {
  const target = `tcp://${ip}:${port}`;
  if (sender && senderTarget === target) return sender;
  if (sender) { try { sender.close(); } catch { /* ok */ } sender = null; }
  sender = new zmq.Dealer();
  await sender.connect(target);
  senderTarget = target;
  await new Promise((r) => setTimeout(r, 200));
  return sender;
}

function resetSender() {
  if (sender) { try { sender.close(); } catch { /* ok */ } sender = null; senderTarget = ""; }
}

// One-shot query socket: fresh per request so no stale responses
async function queryOnce(ip: string, port: string, osc: Buffer): Promise<Buffer | null> {
  const target = `tcp://${ip}:${port}`;
  const sock = new zmq.Dealer();
  await sock.connect(target);
  await new Promise((r) => setTimeout(r, 150));
  try {
    await sock.send(osc);
    const deadline = Date.now() + 2000;
    for await (const frames of sock) {
      const bufs: Buffer[] = [];
      for (const f of frames) bufs.push(Buffer.from(f));
      return Buffer.concat(bufs);
    }
    void deadline;
    return null;
  } finally {
    try { sock.close(); } catch { /* ok */ }
  }
}

export async function POST(req: NextRequest) {
  type Arg = number | string;
  let ip: string, port: string, address: string, typeTags: string, args: Arg[];
  let waitReply: boolean;
  try {
    const body = await req.json() as {
      ip?: string; port?: string;
      address: string; typeTags: string; args: Arg[];
      waitReply?: boolean;
    };
    ip        = body.ip       ?? "192.168.0.117";
    port      = body.port     ?? "2002";
    address   = body.address;
    typeTags  = body.typeTags;
    args      = body.args ?? [];
    waitReply = body.waitReply ?? false;
  } catch {
    return Response.json({ ok: false, error: "bad JSON" }, { status: 400 });
  }

  try {
    const osc = encodeOSC(address, typeTags, args as (number | string | Buffer)[]);
    if (waitReply) {
      const replyBuf = await queryOnce(ip, port, osc);
      if (!replyBuf) {
        return Response.json({ ok: true, bytes: osc.length, reply: null, replyRaw: null });
      }
      const decoded = decodeOSC(replyBuf);
      return Response.json({ ok: true, bytes: osc.length, reply: decoded, replyRaw: replyBuf.toString("hex") });
    }

    const sock = await getSender(ip, port);
    try {
      await sock.send(osc);
    } catch (sendErr) {
      resetSender();
      throw sendErr;
    }

  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
