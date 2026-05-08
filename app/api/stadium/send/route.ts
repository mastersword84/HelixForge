import { NextRequest } from "next/server";
import * as zmq from "zeromq";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// OSC encoder — big-endian, 4-byte aligned
function encodeOSC(address: string, typeTags: string, args: (number | string | Buffer)[]): Buffer {
  function padTo4(len: number) { return Math.ceil(len / 4) * 4; }
  function encodeStr(s: string): Buffer {
    const bytes = Buffer.from(s + "\x00", "utf8");
    const padded = Buffer.alloc(padTo4(bytes.length));
    bytes.copy(padded);
    return padded;
  }

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

// Persistent sender socket (reused across requests to avoid reconnect delay)
let sender: zmq.Publisher | null = null;
let senderTarget = "";

async function getSender(ip: string, port: string): Promise<zmq.Publisher> {
  const target = `tcp://${ip}:${port}`;
  if (sender && senderTarget === target) return sender;
  if (sender) { try { sender.close(); } catch { /* ok */ } }
  sender = new zmq.Publisher();
  await sender.connect(target);
  senderTarget = target;
  // Give ZMQ time to complete the handshake before first send
  await new Promise((r) => setTimeout(r, 50));
  return sender;
}

export async function POST(req: NextRequest) {
  type Arg = number | string;
  let ip: string, port: string, address: string, typeTags: string, args: Arg[];
  try {
    const body = await req.json() as { ip?: string; port?: string; address: string; typeTags: string; args: Arg[] };
    ip        = body.ip       ?? "192.168.0.117";
    port      = body.port     ?? "2001";
    address   = body.address;
    typeTags  = body.typeTags;
    args      = body.args ?? [];
  } catch {
    return Response.json({ ok: false, error: "bad JSON" }, { status: 400 });
  }

  try {
    const osc = encodeOSC(address, typeTags, args as (number | string | Buffer)[]);

    // Frame 0: 8-byte sequence header (zeros from our side)
    const seq = Buffer.alloc(8);
    const pub = await getSender(ip, port);
    await pub.send([seq, osc]);

    return Response.json({ ok: true, bytes: osc.length });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
