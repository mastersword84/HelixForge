"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";

// Msgpack field names packed as big-endian uint32:
// "id__" = 0x69645F5F, "eid_" = 0x6569645F, "mid_" = 0x6D69645F, "vals" = 0x76616C73
const K_ID   = 1768185695;
const K_EID  = 1701405791;
const K_MID  = 1835623519;
const K_VALS = 1986096243;

type DspRaw = Record<string, unknown>;

interface RawEvent {
  type: "connected" | "msg" | "error";
  ip?: string;
  port?: string;
  topic?: string;
  data?: unknown;
  message?: string;
  ports?: string;
}

interface ParamEntry {
  eid: number;
  mid: number;
  vals: number[];
  ts: number;
}

export default function StadiumPage() {
  const [ip, setIp] = useState("192.168.0.117");
  const [ports, setPorts] = useState("2001,2003");
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [params, setParams] = useState<Map<string, ParamEntry>>(new Map());
  const [log, setLog] = useState<string[]>([]);
  const [msgCount, setMsgCount] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [captured, setCaptured] = useState<RawEvent[]>([]);
  const [sendStatus, setSendStatus] = useState("");
  const esRef = useRef<EventSource | null>(null);
  const paramsRef = useRef<Map<string, ParamEntry>>(new Map());
  const capturingRef = useRef(false);
  const capturedRef = useRef<RawEvent[]>([]);

  const appendLog = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-199), line]);
  }, []);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    setStatus("connecting");
    setStatusMsg(`Connecting to ${ip} ports ${ports}…`);
    setMsgCount(0);
    setParams(new Map());
    paramsRef.current = new Map();

    const url = `/api/stadium?ip=${encodeURIComponent(ip)}&ports=${encodeURIComponent(ports)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (e) => {
      let evt: RawEvent;
      try {
        evt = JSON.parse(e.data) as RawEvent;
      } catch {
        return;
      }

      if (evt.type === "connected") {
        setStatus("live");
        setStatusMsg(`Live — ${evt.ip} ports ${ports}`);
        appendLog(`[connected :${evt.port}] ${evt.ip}`);
        return;
      }

      if (evt.type === "error") {
        setStatus("error");
        setStatusMsg(evt.message ?? "unknown error");
        appendLog(`[error] ${evt.message}`);
        es.close();
        return;
      }

      if (evt.type === "msg") {
        setMsgCount((n) => n + 1);
        // capture every non-dspEvent message for replay
        if (capturingRef.current && evt.topic !== "/dspEvent") {
          capturedRef.current = [...capturedRef.current, evt];
          setCaptured([...capturedRef.current]);
        }
        const portLabel = evt.port ? `:${evt.port}` : "";

        if (evt.topic === "/dspEvent") {
          const d = evt.data as DspRaw;
          const idObj = d[K_ID] as DspRaw | undefined;
          const vals = d[K_VALS];

          if (idObj && Array.isArray(vals)) {
            const eid = idObj[K_EID] as number;
            const mid = idObj[K_MID] as number;
            const key = `${eid}:${mid}`;
            const entry: ParamEntry = { eid, mid, vals: vals as number[], ts: Date.now() };
            paramsRef.current = new Map(paramsRef.current).set(key, entry);
            setParams(new Map(paramsRef.current));
          } else {
            appendLog(`[/dspEvent${portLabel}] ${JSON.stringify(evt.data).slice(0, 120)}`);
          }
        } else {
          appendLog(`[${evt.topic}${portLabel}] ${JSON.stringify(evt.data).slice(0, 120)}`);
        }
      }
    };

    es.onerror = () => {
      if (status !== "error") {
        setStatus("error");
        setStatusMsg("EventSource disconnected");
      }
      es.close();
    };
  }, [ip, ports, appendLog, status]);

  const disconnect = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setStatus("idle");
    setStatusMsg("");
  }, []);

  const toggleCapture = useCallback(() => {
    if (capturingRef.current) {
      capturingRef.current = false;
      setCapturing(false);
    } else {
      capturedRef.current = [];
      setCaptured([]);
      capturingRef.current = true;
      setCapturing(true);
    }
  }, []);

  const downloadCapture = useCallback(() => {
    const blob = new Blob([JSON.stringify(capturedRef.current, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `stadium-capture-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  }, []);

  const sendCmd = useCallback(async (address: string, typeTags: string, args: (number | string)[]) => {
    setSendStatus("sending…");
    try {
      const res = await fetch("/api/stadium/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, port: "2001", address, typeTags, args }),
      });
      const j = await res.json() as { ok: boolean; bytes?: number; error?: string };
      setSendStatus(j.ok ? `sent ${j.bytes}b` : `error: ${j.error}`);
    } catch (e) {
      setSendStatus(`fetch error: ${String(e)}`);
    }
    setTimeout(() => setSendStatus(""), 3000);
  }, [ip]);

  useEffect(() => () => { esRef.current?.close(); }, []);

  const statusColor =
    status === "live"
      ? "var(--forge-green, #4ade80)"
      : status === "error"
      ? "var(--forge-red, #f87171)"
      : status === "connecting"
      ? "var(--forge-amber, #fbbf24)"
      : "var(--forge-dim, #666)";

  const sortedParams = [...params.values()].sort((a, b) => b.ts - a.ts);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background: "var(--forge-bg, #0a0a0a)",
        color: "var(--forge-text, #e5e5e5)",
        fontFamily: "var(--font-mono, monospace)",
      }}
    >
      {/* header */}
      <header
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: "rgba(255,255,255,0.08)" }}
      >
        <h1
          className="text-sm font-mono tracking-widest"
          style={{ color: "var(--forge-ember, #ff6b1a)" }}
        >
          STADIUM MONITOR
        </h1>
        <Link
          href="/forge"
          className="text-xs font-mono tracking-widest px-3 py-1.5 rounded transition-colors"
          style={{ color: "var(--forge-ember, #ff6b1a)", border: "1px solid rgba(255,107,26,0.35)" }}
        >
          ← FORGE
        </Link>
      </header>

      <main className="flex-1 flex flex-col gap-4 p-6">
        {/* connection bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs opacity-50">IP</label>
            <input
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              className="px-2 py-1 text-sm rounded"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "inherit",
                width: 150,
              }}
              disabled={status === "live" || status === "connecting"}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs opacity-50">PORTS</label>
            <input
              value={ports}
              onChange={(e) => setPorts(e.target.value)}
              className="px-2 py-1 text-sm rounded"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "inherit",
                width: 110,
              }}
              disabled={status === "live" || status === "connecting"}
            />
          </div>
          {status !== "live" && status !== "connecting" ? (
            <button
              onClick={connect}
              className="px-4 py-1.5 text-xs font-mono tracking-widest rounded transition-colors"
              style={{
                background: "rgba(255,107,26,0.15)",
                border: "1px solid rgba(255,107,26,0.5)",
                color: "var(--forge-ember, #ff6b1a)",
              }}
            >
              CONNECT
            </button>
          ) : (
            <button
              onClick={disconnect}
              className="px-4 py-1.5 text-xs font-mono tracking-widest rounded transition-colors"
              style={{
                background: "rgba(248,113,113,0.12)",
                border: "1px solid rgba(248,113,113,0.4)",
                color: "#f87171",
              }}
            >
              DISCONNECT
            </button>
          )}
          <span className="text-xs font-mono" style={{ color: statusColor }}>
            {statusMsg || "—"}
          </span>
          {status === "live" && (
            <span className="text-xs opacity-40 ml-auto font-mono">
              {msgCount.toLocaleString()} msgs · {params.size} params
            </span>
          )}
        </div>

        {/* capture + send bar */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={toggleCapture}
            className="px-3 py-1 text-xs font-mono tracking-widest rounded transition-colors"
            style={capturing
              ? { background: "rgba(248,113,113,0.18)", border: "1px solid rgba(248,113,113,0.5)", color: "#f87171" }
              : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", color: "inherit" }}
          >
            {capturing ? `■ STOP (${captured.length})` : "● CAPTURE"}
          </button>
          {captured.length > 0 && (
            <button
              onClick={downloadCapture}
              className="px-3 py-1 text-xs font-mono tracking-widest rounded"
              style={{ background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.35)", color: "#4ade80" }}
            >
              ↓ JSON ({captured.length} cmds)
            </button>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs opacity-40 font-mono">SEND:</span>
            <button onClick={() => sendCmd("/heartbeat", "iii", [65535, -1, 1])}
              className="px-2 py-1 text-xs font-mono rounded"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}>
              heartbeat
            </button>
            <button onClick={() => sendCmd("/setParamValue", "iiiff", [66050, -1, 0, 4, 0.5])}
              className="px-2 py-1 text-xs font-mono rounded"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}>
              test param
            </button>
            {sendStatus && (
              <span className="text-xs font-mono" style={{ color: sendStatus.startsWith("error") ? "#f87171" : "#4ade80" }}>
                {sendStatus}
              </span>
            )}
          </div>
        </div>

        {/* content grid */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ minHeight: 0 }}>
          {/* param table */}
          <div
            className="rounded overflow-hidden flex flex-col"
            style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
          >
            <div
              className="px-4 py-2 text-xs tracking-widest opacity-50 border-b flex justify-between"
              style={{ borderColor: "rgba(255,255,255,0.08)" }}
            >
              <span>DSP PARAMS</span>
              <span>{params.size}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {sortedParams.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-xs opacity-30">
                  {status === "live" ? "waiting for /dspEvent…" : "not connected"}
                </div>
              ) : (
                <table className="w-full text-xs font-mono" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <th className="text-left px-4 py-1.5 opacity-40 font-normal w-24">EID:MID</th>
                      <th className="text-left px-4 py-1.5 opacity-40 font-normal">VALS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedParams.map((p) => {
                      const age = Date.now() - p.ts;
                      const fresh = age < 800;
                      const display = p.vals.slice(0, 12);
                      const overflow = p.vals.length - display.length;
                      const nonZero = p.vals.some((v) => typeof v === "number" && v !== 0);
                      return (
                        <tr
                          key={`${p.eid}:${p.mid}`}
                          style={{
                            borderBottom: "1px solid rgba(255,255,255,0.04)",
                            background: fresh ? "rgba(255,107,26,0.08)" : undefined,
                            transition: "background 0.6s",
                          }}
                        >
                          <td
                            className="px-4 py-1.5 font-mono align-top"
                            style={{ color: "var(--forge-ember, #ff6b1a)", whiteSpace: "nowrap" }}
                          >
                            {p.eid}:{p.mid}
                          </td>
                          <td className="px-4 py-1.5 align-top" style={{ opacity: nonZero ? 1 : 0.3 }}>
                            {display.map((v) =>
                              typeof v === "number" ? v.toFixed(4) : String(v)
                            ).join("  ")}
                            {overflow > 0 && (
                              <span className="opacity-40 ml-2">+{overflow} more</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* event log */}
          <div
            className="rounded overflow-hidden flex flex-col"
            style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
          >
            <div
              className="px-4 py-2 text-xs tracking-widest opacity-50 border-b flex justify-between"
              style={{ borderColor: "rgba(255,255,255,0.08)" }}
            >
              <span>EVENT LOG</span>
              <button
                onClick={() => setLog([])}
                className="opacity-40 hover:opacity-80 transition-opacity"
              >
                CLEAR
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-0.5">
              {log.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-xs opacity-30">
                  non-DSP events appear here
                </div>
              ) : (
                log.map((line, i) => (
                  <div key={i} className="text-xs opacity-70 font-mono leading-relaxed">
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
