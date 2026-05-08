/// <reference types="w3c-web-usb" />
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// openhx handshake packet 1 (OPEN_STREAM opcode 0x0C)
// Source: https://github.com/allansomensi/openhx
const HANDSHAKE_PACKET = new Uint8Array([
  0x0c, 0x00, 0x00, 0x28, 0x01, 0x10, 0xef, 0x03,
  0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0x00, 0x21,
  0x00, 0x10, 0x00, 0x00,
]);

const LINE6_VENDOR_ID = 0x0e41;

const KNOWN_PIDS: Record<number, string> = {
  0x4841: "Helix Stadium XL",  // confirmed 2026-05-07 via WebUSB enumeration
  0x4253: "HX Stomp XL",
  0x4252: "HX Stomp",
  0x4250: "Helix Floor",
  0x4251: "Helix Rack",
  0x4248: "Helix LT",
};

interface LogEntry {
  ts: string;
  dir: "in" | "out" | "info" | "error" | "warn";
  text: string;
}

interface EndpointInfo {
  interfaceIndex: number;
  endpointNumber: number;
  direction: "in" | "out";
  type: string;
}

interface DeviceState {
  device: USBDevice;
  productName: string;
  pid: number;
  knownModel: string | null;
  serial: string;
  bulkOut: EndpointInfo | null;
  bulkIn: EndpointInfo | null;
  allEndpoints: EndpointInfo[];
  claimedInterface: number | null;
}

function formatBytes(bytes: Uint8Array | number[]): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

function pid(n: number) {
  return `0x${n.toString(16).padStart(4, "0")}`;
}

export default function WebUSBPage() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [deviceState, setDeviceState] = useState<DeviceState | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [outEp, setOutEp] = useState<number>(1);
  const [inEp, setInEp] = useState<number>(1);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && "usb" in navigator);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  function appendLog(dir: LogEntry["dir"], text: string) {
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLog((prev) => [...prev.slice(-299), { ts, dir, text }]);
  }

  function enumerateEndpoints(device: USBDevice): EndpointInfo[] {
    const eps: EndpointInfo[] = [];
    const config = device.configurations[0];
    if (!config) return eps;
    config.interfaces.forEach((iface) => {
      const alt = iface.alternate;
      alt.endpoints.forEach((ep) => {
        eps.push({
          interfaceIndex: iface.interfaceNumber,
          endpointNumber: ep.endpointNumber,
          direction: ep.direction as "in" | "out",
          type: ep.type,
        });
      });
    });
    return eps;
  }

  async function connect() {
    setBusy(true);
    try {
      const device = await navigator.usb.requestDevice({
        filters: [{ vendorId: LINE6_VENDOR_ID }],
      });

      appendLog("info", `Device selected: ${device.productName ?? "(unnamed)"} VID=${pid(device.vendorId)} PID=${pid(device.productId)}`);

      await device.open();
      appendLog("info", "USB device opened.");

      if (device.configuration === null) {
        await device.selectConfiguration(1);
        appendLog("info", "Configuration 1 selected.");
      }

      const allEndpoints = enumerateEndpoints(device);
      appendLog("info", `Found ${device.configurations[0]?.interfaces.length ?? 0} interface(s), ${allEndpoints.length} endpoint(s).`);
      allEndpoints.forEach((ep) => {
        appendLog("info", `  Interface ${ep.interfaceIndex} · EP ${ep.endpointNumber} · ${ep.direction.toUpperCase()} · ${ep.type}`);
      });

      // Collect all bulk interface candidates (bInterfaceNumber, NOT array index).
      // Try each in order — skip "protected class" interfaces (e.g. USB audio on Stadium).
      type BulkCandidate = { ifaceNum: number; bOut: USBEndpoint; bIn: USBEndpoint };
      const bulkCandidates: BulkCandidate[] = [];
      const config = device.configurations[0];
      if (config) {
        for (const iface of config.interfaces) {
          const alt = iface.alternate;
          const bOut = alt.endpoints.find((e) => e.type === "bulk" && e.direction === "out");
          const bIn = alt.endpoints.find((e) => e.type === "bulk" && e.direction === "in");
          if (bOut && bIn) bulkCandidates.push({ ifaceNum: iface.interfaceNumber, bOut, bIn });
        }
      }

      let bulkOut: EndpointInfo | null = null;
      let bulkIn: EndpointInfo | null = null;
      let claimedInterface: number | null = null;

      for (const candidate of bulkCandidates) {
        try {
          await device.claimInterface(candidate.ifaceNum);
          claimedInterface = candidate.ifaceNum;
          bulkOut = { interfaceIndex: candidate.ifaceNum, endpointNumber: candidate.bOut.endpointNumber, direction: "out", type: "bulk" };
          bulkIn = { interfaceIndex: candidate.ifaceNum, endpointNumber: candidate.bIn.endpointNumber, direction: "in", type: "bulk" };
          appendLog("info", `Interface ${candidate.ifaceNum} claimed — bulk OUT EP${bulkOut.endpointNumber}, bulk IN EP${bulkIn.endpointNumber}.`);
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          appendLog("info", `Interface ${candidate.ifaceNum} skipped: ${msg}`);
        }
      }

      if (claimedInterface === null) {
        appendLog("warn", bulkCandidates.length > 0
          ? "All bulk interfaces failed to claim. On Windows: run Zadig → Helix Stadium Bulk Transfer → WinUSB → Replace Driver, then reconnect."
          : "No interface with both bulk OUT and IN found.");
      }

      if (bulkOut) setOutEp(bulkOut.endpointNumber);
      if (bulkIn) setInEp(bulkIn.endpointNumber);

      setDeviceState({
        device,
        productName: device.productName ?? "(unnamed)",
        pid: device.productId,
        knownModel: KNOWN_PIDS[device.productId] ?? null,
        serial: device.serialNumber ?? "(none)",
        bulkOut,
        bulkIn,
        allEndpoints,
        claimedInterface,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("No device selected")) {
        appendLog("info", "Device picker cancelled.");
      } else {
        appendLog("error", `Connect failed: ${msg}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!deviceState) return;
    try {
      if (deviceState.claimedInterface !== null) {
        await deviceState.device.releaseInterface(deviceState.claimedInterface);
      }
      await deviceState.device.close();
      appendLog("info", "Device closed.");
    } catch (err) {
      appendLog("warn", `Close error: ${err instanceof Error ? err.message : String(err)}`);
    }
    setDeviceState(null);
  }

  async function sendHandshake() {
    if (!deviceState) return;
    setBusy(true);
    try {
      const result = await deviceState.device.transferOut(outEp, HANDSHAKE_PACKET);
      appendLog("out", `EP${outEp} → ${formatBytes(HANDSHAKE_PACKET)}`);
      appendLog("info", `transferOut status: ${result.status} (${result.bytesWritten} bytes written)`);

      // Immediately attempt to read a response
      await readOnce(deviceState.device, true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendLog("error", `transferOut failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function readOnce(device: USBDevice, fromHandshake = false, timeoutMs = 3000) {
    setReading(true);
    try {
      const readPromise = device.transferIn(inEp, 512);
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
      const winner = await Promise.race([readPromise, timeoutPromise]);

      if (winner === null) {
        appendLog("info", `transferIn timed out after ${timeoutMs}ms — no response from device.`);
        if (fromHandshake) appendLog("info", "Packet was accepted (status ok) but Stadium sent no reply. This may need a different opcode sequence.");
        return;
      }

      const result = winner;
      if (result.data && result.data.byteLength > 0) {
        const bytes = new Uint8Array(result.data.buffer);
        appendLog("in", `EP${inEp} ← ${formatBytes(bytes)}`);
        if (fromHandshake) {
          appendLog("info", "*** DEVICE RESPONDED — USB bulk path is fully alive! ***");
        }
      } else {
        appendLog("info", `transferIn status: ${result.status} — no data`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendLog(fromHandshake ? "warn" : "error", `transferIn failed: ${msg}`);
    } finally {
      setReading(false);
    }
  }

  async function sendRaw(hexStr: string) {
    if (!deviceState) return;
    const cleaned = hexStr.replace(/\s+/g, "");
    if (cleaned.length % 2 !== 0) {
      appendLog("error", "Odd hex string length — fix the bytes and retry.");
      return;
    }
    const bytes = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
    }
    setBusy(true);
    try {
      const result = await deviceState.device.transferOut(outEp, bytes);
      appendLog("out", `EP${outEp} → ${formatBytes(bytes)}`);
      appendLog("info", `transferOut status: ${result.status}`);
    } catch (err) {
      appendLog("error", `transferOut failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen px-6 py-12" style={{ background: "var(--forge-black)" }}>
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded flex items-center justify-center text-sm font-bold"
              style={{ background: "var(--forge-ember)", color: "var(--forge-black)", fontFamily: "Geist Mono, monospace" }}
            >
              HF
            </div>
            <Link href="/" className="text-lg font-bold tracking-tight"
              style={{ fontFamily: "Geist Mono, monospace", color: "var(--forge-text)" }}>
              HelixForge
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/sysex" className="text-sm font-mono" style={{ color: "var(--forge-faint)" }}>
              MIDI Monitor
            </Link>
            <Link href="/forge" className="text-sm font-mono" style={{ color: "var(--forge-muted)" }}>
              ← Back to Forge
            </Link>
          </div>
        </div>

        {/* Title */}
        <div className="mb-10">
          <p className="text-xs font-mono mb-3" style={{ color: "var(--forge-ember)", letterSpacing: "0.15em" }}>
            MILESTONE 02 · WEBUSB HANDSHAKE
          </p>
          <h1
            className="text-5xl md:text-6xl font-black tracking-tighter"
            style={{
              fontFamily: "Geist Mono, monospace",
              background: "linear-gradient(135deg, var(--forge-ember) 0%, var(--forge-glow) 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            WEBUSB
          </h1>
          <p className="mt-4 text-base max-w-2xl" style={{ color: "var(--forge-muted)" }}>
            Tests the openhx USB bulk protocol against the Stadium. If the device responds to the
            handshake, the browser can talk to it directly — bypassing the .hsp importer entirely.
          </p>
        </div>

        {/* Windows driver warning */}
        <div
          className="p-4 rounded mb-8 text-sm font-mono"
          style={{ background: "rgba(255,170,0,0.08)", border: "1px solid rgba(255,170,0,0.35)", color: "#ffcc44" }}
        >
          <p className="font-bold mb-1 tracking-wider text-xs">WINDOWS DRIVER NOTE</p>
          <p style={{ color: "rgba(255,204,68,0.8)" }}>
            WebUSB requires the device to use the WinUSB driver. If Chrome can&apos;t claim the
            interface, run{" "}
            <span style={{ color: "#ffcc44" }}>Zadig</span> → select the Line 6 device →
            replace the driver with <span style={{ color: "#ffcc44" }}>WinUSB</span>. HX Edit
            won&apos;t work while WinUSB is installed — swap back with Zadig when done.
          </p>
        </div>

        {/* Browser support */}
        {supported === false && (
          <div
            className="p-4 rounded mb-6 font-mono text-sm"
            style={{ background: "rgba(255,80,80,0.12)", border: "1px solid #ff5050", color: "#ffb0b0" }}
          >
            This browser does not support WebUSB. Use Chrome, Edge, or a Chromium-based browser.
          </div>
        )}

        {/* Connect */}
        {supported && !deviceState && (
          <div className="mb-8">
            <button
              onClick={connect}
              disabled={busy}
              className="px-8 py-4 rounded font-bold text-base transition-all"
              style={{
                background: "var(--forge-ember)",
                color: "var(--forge-black)",
                fontFamily: "Geist Mono, monospace",
                opacity: busy ? 0.6 : 1,
                boxShadow: busy ? "none" : "0 0 20px rgba(255,107,26,0.3)",
              }}
            >
              {busy ? "OPENING..." : "SELECT LINE 6 DEVICE"}
            </button>
            <p className="mt-3 text-sm font-mono" style={{ color: "var(--forge-faint)" }}>
              Stadium must be plugged in via USB. Browser will show a device picker.
            </p>
          </div>
        )}

        {/* Device info + controls */}
        {deviceState && (
          <>
            {/* Device card */}
            <div
              className="rounded p-5 mb-6"
              style={{ background: "var(--forge-steel)", border: "1px solid var(--forge-border)" }}
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-xs font-mono px-2 py-0.5 rounded"
                      style={{
                        background: deviceState.knownModel ? "var(--forge-ember)" : "var(--forge-iron)",
                        color: deviceState.knownModel ? "var(--forge-black)" : "var(--forge-muted)",
                      }}
                    >
                      {deviceState.knownModel ?? "UNKNOWN MODEL"}
                    </span>
                    {!deviceState.knownModel && (
                      <span className="text-xs font-mono" style={{ color: "var(--forge-muted)" }}>
                        PID {pid(deviceState.pid)} not in known list — may still work
                      </span>
                    )}
                  </div>
                  <p className="text-lg font-bold font-mono" style={{ color: "var(--forge-text)" }}>
                    {deviceState.productName}
                  </p>
                </div>
                <button
                  onClick={disconnect}
                  className="text-xs font-mono px-3 py-1.5 rounded transition-colors shrink-0"
                  style={{ border: "1px solid var(--forge-border)", color: "var(--forge-muted)" }}
                >
                  Disconnect
                </button>
              </div>

              <div className="grid sm:grid-cols-3 gap-4 font-mono text-sm mb-5">
                <InfoField label="VID" value={pid(LINE6_VENDOR_ID)} />
                <InfoField label="PID" value={pid(deviceState.pid)} />
                <InfoField label="Serial" value={deviceState.serial} />
              </div>

              {/* Endpoint tree */}
              <p className="text-xs font-mono mb-2 tracking-wider" style={{ color: "var(--forge-faint)" }}>
                USB ENDPOINTS
              </p>
              <div className="grid gap-1">
                {deviceState.allEndpoints.map((ep, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-3 py-1.5 rounded text-xs font-mono"
                    style={{
                      background: ep.type === "bulk"
                        ? ep.direction === "out"
                          ? "rgba(255,107,26,0.08)"
                          : "rgba(74,240,255,0.08)"
                        : "var(--forge-iron)",
                      border: `1px solid ${ep.type === "bulk" ? (ep.direction === "out" ? "rgba(255,107,26,0.25)" : "rgba(74,240,255,0.25)") : "var(--forge-border)"}`,
                    }}
                  >
                    <span style={{ color: "var(--forge-faint)" }}>iface {ep.interfaceIndex}</span>
                    <span
                      className="px-1.5 py-0.5 rounded"
                      style={{
                        background: ep.type === "bulk" ? (ep.direction === "out" ? "var(--forge-ember)" : "var(--forge-arc)") : "var(--forge-iron)",
                        color: ep.type === "bulk" ? "var(--forge-black)" : "var(--forge-muted)",
                        fontSize: "10px",
                      }}
                    >
                      EP{ep.endpointNumber}
                    </span>
                    <span style={{ color: ep.direction === "out" ? "var(--forge-ember)" : "var(--forge-arc)" }}>
                      {ep.direction.toUpperCase()}
                    </span>
                    <span style={{ color: "var(--forge-muted)" }}>{ep.type}</span>
                    {ep.type === "bulk" && ep.direction === "out" && ep.endpointNumber === outEp && (
                      <span className="text-xs" style={{ color: "var(--forge-ember)" }}>← active OUT</span>
                    )}
                    {ep.type === "bulk" && ep.direction === "in" && ep.endpointNumber === inEp && (
                      <span className="text-xs" style={{ color: "var(--forge-arc)" }}>← active IN</span>
                    )}
                  </div>
                ))}
                {deviceState.allEndpoints.length === 0 && (
                  <p className="text-xs font-mono" style={{ color: "var(--forge-faint)" }}>
                    No endpoints found in configuration descriptor.
                  </p>
                )}
              </div>

              {/* EP selector (manual override) */}
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div>
                  <p className="text-xs font-mono mb-1 tracking-wider" style={{ color: "var(--forge-faint)" }}>
                    BULK OUT EP#
                  </p>
                  <input
                    type="number"
                    min={1}
                    max={15}
                    value={outEp}
                    onChange={(e) => setOutEp(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 rounded font-mono text-sm"
                    style={{ background: "var(--forge-iron)", border: "1px solid var(--forge-border)", color: "var(--forge-text)" }}
                  />
                </div>
                <div>
                  <p className="text-xs font-mono mb-1 tracking-wider" style={{ color: "var(--forge-faint)" }}>
                    BULK IN EP#
                  </p>
                  <input
                    type="number"
                    min={1}
                    max={15}
                    value={inEp}
                    onChange={(e) => setInEp(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 rounded font-mono text-sm"
                    style={{ background: "var(--forge-iron)", border: "1px solid var(--forge-border)", color: "var(--forge-text)" }}
                  />
                </div>
              </div>
            </div>

            {/* Interface claim status */}
            {deviceState.claimedInterface === null && (
              <div
                className="p-4 rounded mb-6 text-sm font-mono"
                style={{ background: "rgba(255,80,80,0.10)", border: "1px solid rgba(255,80,80,0.4)", color: "#ffb0b0" }}
              >
                Interface claim failed — handshake will not work until the interface is claimed.
                On Windows, use Zadig to switch the Line 6 USB device to WinUSB driver, then reconnect.
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-3 mb-8">
              <button
                onClick={sendHandshake}
                disabled={busy || reading || deviceState.claimedInterface === null}
                className="px-6 py-3 rounded font-bold text-sm transition-all"
                style={{
                  background: "var(--forge-ember)",
                  color: "var(--forge-black)",
                  fontFamily: "Geist Mono, monospace",
                  opacity: (busy || reading || deviceState.claimedInterface === null) ? 0.4 : 1,
                  cursor: (busy || reading || deviceState.claimedInterface === null) ? "not-allowed" : "pointer",
                  boxShadow: (!busy && !reading && deviceState.claimedInterface !== null) ? "0 0 16px rgba(255,107,26,0.3)" : "none",
                }}
              >
                {busy ? "SENDING..." : "SEND HANDSHAKE"}
              </button>

              <code
                className="text-xs px-3 py-2 rounded font-mono flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                style={{ background: "var(--forge-iron)", color: "var(--forge-faint)" }}
              >
                {formatBytes(HANDSHAKE_PACKET)}
              </code>

              <button
                onClick={() => readOnce(deviceState.device)}
                disabled={busy || reading || deviceState.claimedInterface === null}
                className="px-4 py-3 rounded font-bold text-sm transition-all"
                style={{
                  border: "1px solid var(--forge-arc)",
                  color: (busy || reading || deviceState.claimedInterface === null) ? "var(--forge-faint)" : "var(--forge-arc)",
                  background: "transparent",
                  fontFamily: "Geist Mono, monospace",
                  opacity: (busy || reading || deviceState.claimedInterface === null) ? 0.4 : 1,
                  cursor: (busy || reading || deviceState.claimedInterface === null) ? "not-allowed" : "pointer",
                }}
              >
                {reading ? "READING..." : "READ ONCE"}
              </button>
            </div>

            {/* Raw send */}
            <RawSendPanel onSend={sendRaw} busy={busy || reading} />
          </>
        )}

        {/* Activity log */}
        {log.length > 0 && (
          <div
            className="rounded p-4 mt-6"
            style={{ background: "var(--forge-steel)", border: "1px solid var(--forge-border)" }}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-mono tracking-widest" style={{ color: "var(--forge-muted)", letterSpacing: "0.15em" }}>
                ACTIVITY LOG
              </p>
              <button onClick={() => setLog([])} className="text-xs font-mono" style={{ color: "var(--forge-faint)" }}>
                clear
              </button>
            </div>
            <div
              ref={logRef}
              className="font-mono text-xs space-y-1 max-h-96 overflow-y-auto"
              style={{ color: "var(--forge-text)" }}
            >
              {log.map((e, i) => (
                <div key={i} className="flex gap-3">
                  <span style={{ color: "var(--forge-faint)" }}>{e.ts}</span>
                  <span
                    className="w-10 shrink-0"
                    style={{
                      color:
                        e.dir === "in" ? "var(--forge-arc)"
                        : e.dir === "out" ? "var(--forge-ember)"
                        : e.dir === "error" ? "#ff8080"
                        : e.dir === "warn" ? "#ffcc44"
                        : "var(--forge-muted)",
                    }}
                  >
                    {e.dir.toUpperCase()}
                  </span>
                  <span className="flex-1 break-all">{e.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Protocol reference */}
        <details className="mt-8">
          <summary
            className="text-xs font-mono cursor-pointer tracking-widest"
            style={{ color: "var(--forge-faint)" }}
          >
            PROTOCOL REFERENCE (openhx)
          </summary>
          <div
            className="mt-3 p-4 rounded text-xs font-mono space-y-2"
            style={{ background: "var(--forge-steel)", border: "1px solid var(--forge-border)", color: "var(--forge-muted)" }}
          >
            <p style={{ color: "var(--forge-arc)" }}>Opcodes (header byte 0)</p>
            <p>0x04 SESSION_OPEN · 0x08 SESSION_CHUNK · 0x0C OPEN_STREAM</p>
            <p style={{ color: "var(--forge-arc)", marginTop: 8 }}>HX Stomp XL USB identifiers (may differ on Stadium)</p>
            <p>VID 0x0E41 · PID 0x4253 · OUT EP 0x01 · IN EP 0x81</p>
            <p style={{ color: "var(--forge-arc)", marginTop: 8 }}>Packet structure: 16-byte header + MessagePack payload</p>
            <p>Handshake packet 1: 0C 00 00 28 01 10 EF 03 00 00 00 02 00 01 00 21 00 10 00 00</p>
            <p style={{ color: "var(--forge-arc)", marginTop: 8 }}>Stadium caveat</p>
            <p>Stadium&apos;s companion editor uses Wi-Fi, not USB. No community USB capture exists for Stadium yet. This page is testing whether Stadium <em>also</em> responds to the HX Stomp USB bulk protocol when plugged in.</p>
          </div>
        </details>
      </div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs mb-1" style={{ color: "var(--forge-faint)", letterSpacing: "0.1em" }}>{label}</p>
      <p style={{ color: "var(--forge-text)" }}>{value}</p>
    </div>
  );
}

function RawSendPanel({ onSend, busy }: { onSend: (hex: string) => void; busy: boolean }) {
  const [hex, setHex] = useState("");
  return (
    <div
      className="rounded p-4 mb-6"
      style={{ background: "var(--forge-steel)", border: "1px solid var(--forge-border)" }}
    >
      <p className="text-xs font-mono mb-3 tracking-widest" style={{ color: "var(--forge-faint)" }}>
        SEND RAW BYTES
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          placeholder="0C 00 00 28 ..."
          className="flex-1 px-3 py-2 rounded font-mono text-xs"
          style={{ background: "var(--forge-iron)", border: "1px solid var(--forge-border)", color: "var(--forge-text)" }}
          onKeyDown={(e) => { if (e.key === "Enter" && hex.trim()) onSend(hex); }}
        />
        <button
          onClick={() => hex.trim() && onSend(hex)}
          disabled={busy || !hex.trim()}
          className="px-4 py-2 rounded text-xs font-mono font-bold transition-all"
          style={{
            background: "var(--forge-iron)",
            color: (!busy && hex.trim()) ? "var(--forge-text)" : "var(--forge-faint)",
            border: "1px solid var(--forge-border)",
            cursor: (!busy && hex.trim()) ? "pointer" : "not-allowed",
          }}
        >
          SEND
        </button>
      </div>
      <p className="text-xs mt-2 font-mono" style={{ color: "var(--forge-faint)" }}>
        Hex pairs, space-separated or run together. ↵ to send.
      </p>
    </div>
  );
}
