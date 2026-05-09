import { NextRequest } from "next/server";
import * as zmq from "zeromq";
import { decode } from "@msgpack/msgpack";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Minimal OSC parser (big-endian, 4-byte aligned)
function parseOSC(buf: Buffer): { address: string; args: unknown[] } | null {
  try {
    const addrNull = buf.indexOf(0, 0);
    if (addrNull < 0) return null;
    const address = buf.slice(0, addrNull).toString("utf8");
    let pos = (Math.floor(addrNull / 4) + 1) * 4;

    if (buf[pos] !== 0x2c) return null;
    const tagNull = buf.indexOf(0, pos);
    const typeTags = buf.slice(pos + 1, tagNull).toString("utf8");
    pos = (Math.floor(tagNull / 4) + 1) * 4;

    const args: unknown[] = [];
    for (const tag of typeTags) {
      if (tag === "i") {
        args.push(buf.readInt32BE(pos)); pos += 4;
      } else if (tag === "f") {
        args.push(buf.readFloatBE(pos)); pos += 4;
      } else if (tag === "b") {
        const blobLen = buf.readUInt32BE(pos); pos += 4;
        args.push(buf.slice(pos, pos + blobLen));
        pos += Math.ceil(blobLen / 4) * 4;
      } else if (tag === "s") {
        const sNull = buf.indexOf(0, pos);
        args.push(buf.slice(pos, sNull).toString("utf8"));
        pos = (Math.floor(sNull / 4) + 1) * 4;
      }
    }
    return { address, args };
  } catch {
    return null;
  }
}

async function subscribePort(
  ip: string,
  port: string,
  send: (obj: unknown) => void,
  socks: zmq.Subscriber[]
) {
  const sock = new zmq.Subscriber();
  socks.push(sock);
  await sock.connect(`tcp://${ip}:${port}`);
  sock.subscribe("");
  send({ type: "connected", ip, port });

  for await (const msg of sock) {
    const frames: Buffer[] = [];
    for (const f of msg as Iterable<Buffer>) frames.push(f);

    const oscFrame = frames.length >= 2 ? frames[1] : frames[0];
    if (!oscFrame) continue;

    const osc = parseOSC(oscFrame);
    if (!osc) {
      send({ type: "msg", port, topic: "?", data: { hex: oscFrame.slice(0, 32).toString("hex") } });
      continue;
    }

    if (osc.address === "/dspEvent" && osc.args[0] instanceof Buffer) {
      let data: unknown;
      try { data = decode(osc.args[0] as Buffer); }
      catch { data = { raw: Array.from(osc.args[0] as Buffer).slice(0, 32) }; }
      send({ type: "msg", port, topic: "/dspEvent", data });
    } else {
      send({
        type: "msg",
        port,
        topic: osc.address,
        data: {
          args: osc.args.map((a) => {
            if (!(a instanceof Buffer)) return a;
            const buf = a as Buffer;
            // Line 6 blobs: 8-byte ASCII magic prefix before msgpack
            const magic = buf.slice(0, 8).toString("ascii");
            const hasMagic = magic === "lavppgsm" || magic === "_sbepgsm";
            if (hasMagic) {
              try {
                const decoded = decode(buf.slice(8));
                return { _magic: magic, _msgpack: decoded, _len: buf.length };
              } catch { /* fall through */ }
            }
            // Try plain msgpack (e.g. /loadContentRef blobs have no prefix)
            try {
              const decoded = decode(buf);
              return { _msgpack: decoded, _len: buf.length };
            } catch { /* not msgpack */ }
            // Fall back to base64 so the full bytes are preserved in captures
            return { _b64: buf.toString("base64"), _len: buf.length };
          }),
        },
      });
    }
  }
}

export async function GET(req: NextRequest) {
  const ip = req.nextUrl.searchParams.get("ip") ?? "192.168.0.117";
  const portsParam = req.nextUrl.searchParams.get("ports") ?? "2003";
  const ports = portsParam.split(",").map((p) => p.trim()).filter(Boolean);

  const encoder = new TextEncoder();
  const socks: zmq.Subscriber[] = [];

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch { /* closed */ }
      };

      try {
        // Fan out to all requested ports concurrently
        await Promise.all(
          ports.map((port) => subscribePort(ip, port, send, socks))
        );
      } catch (err) {
        send({ type: "error", message: String(err) });
        try { controller.close(); } catch { /* ok */ }
      }
    },
    cancel() {
      for (const s of socks) { try { s.close(); } catch { /* ok */ } }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
