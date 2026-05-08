"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  IDENTITY_REQUEST,
  IdentityReply,
  formatBytes,
  isLine6,
  parseIdentityReply,
} from "@/lib/sysex";

interface DeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
}

interface LogEntry {
  ts: string;
  dir: "in" | "out" | "info" | "error";
  text: string;
}

export default function SysExPage() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [access, setAccess] = useState<MIDIAccess | null>(null);
  const [inputs, setInputs] = useState<DeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<DeviceInfo[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string>("");
  const [selectedOutputId, setSelectedOutputId] = useState<string>("");
  const [reply, setReply] = useState<IdentityReply | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && "requestMIDIAccess" in navigator);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  function appendLog(dir: LogEntry["dir"], text: string) {
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLog((prev) => [...prev.slice(-199), { ts, dir, text }]);
  }

  function refreshDevices(midi: MIDIAccess) {
    const ins: DeviceInfo[] = [];
    midi.inputs.forEach((p) => ins.push({ id: p.id, name: p.name ?? "(unnamed)", manufacturer: p.manufacturer ?? "" }));
    const outs: DeviceInfo[] = [];
    midi.outputs.forEach((p) => outs.push({ id: p.id, name: p.name ?? "(unnamed)", manufacturer: p.manufacturer ?? "" }));
    setInputs(ins);
    setOutputs(outs);

    // Auto-select first device whose name mentions "helix" (or "stadium").
    const helixIn = ins.find((d) => /helix|stadium/i.test(d.name));
    const helixOut = outs.find((d) => /helix|stadium/i.test(d.name));
    if (helixIn && !selectedInputId) setSelectedInputId(helixIn.id);
    if (helixOut && !selectedOutputId) setSelectedOutputId(helixOut.id);
  }

  async function connect() {
    setError(null);
    setBusy(true);
    try {
      const midi = await navigator.requestMIDIAccess({ sysex: true });
      setAccess(midi);
      refreshDevices(midi);
      midi.onstatechange = () => refreshDevices(midi);
      appendLog("info", "Web MIDI access granted (sysex enabled).");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Permission denied or Web MIDI unavailable: ${msg}`);
      appendLog("error", `Connect failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  // Subscribe to the selected input port for incoming SysEx.
  useEffect(() => {
    if (!access || !selectedInputId) return;
    const port = access.inputs.get(selectedInputId);
    if (!port) return;

    const handler = (ev: Event) => {
      const e = ev as MIDIMessageEvent;
      const data = e.data;
      if (!data || data.length === 0) return;

      // SysEx — full hex dump + parse.
      if (data[0] === 0xf0) {
        appendLog("in", formatBytes(data));
        const parsed = parseIdentityReply(data);
        if (parsed) {
          setReply(parsed);
          appendLog(
            "info",
            `Identity reply parsed: ${parsed.manufacturerName} · family=0x${parsed.familyCode
              .toString(16)
              .padStart(4, "0")} · member=0x${parsed.memberCode
              .toString(16)
              .padStart(4, "0")} · v${parsed.versionString}`,
          );
        }
        return;
      }

      // Non-SysEx — just label the channel-voice event so we can prove the IN port is alive.
      const status = data[0];
      const type = status & 0xf0;
      const channel = (status & 0x0f) + 1;
      let label = `0x${status.toString(16).padStart(2, "0")}`;
      if (type === 0x90) label = `Note On  ch${channel} note=${data[1]} vel=${data[2]}`;
      else if (type === 0x80) label = `Note Off ch${channel} note=${data[1]} vel=${data[2]}`;
      else if (type === 0xb0) label = `CC       ch${channel} cc=${data[1]} val=${data[2]}`;
      else if (type === 0xc0) label = `PC       ch${channel} program=${data[1]}`;
      else if (type === 0xe0) label = `Pitch    ch${channel} ${data[1]} ${data[2]}`;
      appendLog("in", label);
    };

    port.addEventListener("midimessage", handler);
    appendLog("info", `Listening on input: ${port.name}`);

    return () => {
      port.removeEventListener("midimessage", handler);
    };
  }, [access, selectedInputId]);

  function sendInquiry() {
    if (!access || !selectedOutputId) {
      setError("Pick an output device first.");
      return;
    }
    const port = access.outputs.get(selectedOutputId);
    if (!port) {
      setError("Output port not found.");
      return;
    }
    setError(null);
    setReply(null);
    try {
      port.send(Array.from(IDENTITY_REQUEST));
      appendLog("out", formatBytes(IDENTITY_REQUEST));
      appendLog("info", `Identity Request sent to: ${port.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Send failed: ${msg}`);
      appendLog("error", `Send failed: ${msg}`);
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
              style={{
                background: "var(--forge-ember)",
                color: "var(--forge-black)",
                fontFamily: "Geist Mono, monospace",
              }}
            >
              HF
            </div>
            <Link
              href="/"
              className="text-lg font-bold tracking-tight"
              style={{ fontFamily: "Geist Mono, monospace", color: "var(--forge-text)" }}
            >
              HelixForge
            </Link>
          </div>
          <Link
            href="/forge"
            className="text-sm font-mono"
            style={{ color: "var(--forge-muted)" }}
          >
            ← Back to Forge
          </Link>
        </div>

        {/* Title */}
        <div className="mb-10">
          <p
            className="text-xs font-mono mb-3"
            style={{ color: "var(--forge-arc)", letterSpacing: "0.15em" }}
          >
            MILESTONE 01 · WEB MIDI HANDSHAKE
          </p>
          <h1
            className="text-5xl md:text-6xl font-black tracking-tighter"
            style={{
              fontFamily: "Geist Mono, monospace",
              background:
                "linear-gradient(135deg, var(--forge-arc) 0%, var(--forge-glow) 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            SYSEX
          </h1>
          <p className="mt-4 text-base max-w-2xl" style={{ color: "var(--forge-muted)" }}>
            Direct two-way MIDI conversation with the Stadium. Sends a Universal SysEx Inquiry
            and parses the reply — proves the browser can talk to the device without going
            through the .hsp file importer.
          </p>
        </div>

        {/* Browser support */}
        {supported === false && (
          <div
            className="p-4 rounded mb-6 font-mono text-sm"
            style={{ background: "rgba(255,80,80,0.12)", border: "1px solid #ff5050", color: "#ffb0b0" }}
          >
            ⚠ This browser does not support Web MIDI. Use Chrome, Edge, or Opera.
          </div>
        )}

        {/* Connect step */}
        {supported && !access && (
          <div className="mb-8">
            <button
              onClick={connect}
              disabled={busy}
              className="px-8 py-4 rounded font-bold text-base ember-glow transition-all"
              style={{
                background: "var(--forge-arc)",
                color: "var(--forge-black)",
                fontFamily: "Geist Mono, monospace",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? "REQUESTING..." : "CONNECT WEB MIDI"}
            </button>
            <p className="mt-3 text-sm font-mono" style={{ color: "var(--forge-faint)" }}>
              Browser will prompt for SysEx permission. Stadium must be plugged in via USB.
            </p>
          </div>
        )}

        {/* Device pickers */}
        {access && (
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <DevicePicker
              label="MIDI INPUT"
              hint="Stadium → Browser"
              devices={inputs}
              value={selectedInputId}
              onChange={setSelectedInputId}
            />
            <DevicePicker
              label="MIDI OUTPUT"
              hint="Browser → Stadium"
              devices={outputs}
              value={selectedOutputId}
              onChange={setSelectedOutputId}
            />
          </div>
        )}

        {/* Send Inquiry */}
        {access && (
          <div className="mb-8 flex items-center gap-3">
            <button
              onClick={sendInquiry}
              disabled={!selectedOutputId}
              className="px-6 py-3 rounded font-bold text-sm transition-all"
              style={{
                background: "var(--forge-ember)",
                color: "var(--forge-black)",
                fontFamily: "Geist Mono, monospace",
                opacity: selectedOutputId ? 1 : 0.4,
                cursor: selectedOutputId ? "pointer" : "not-allowed",
              }}
            >
              SEND IDENTITY REQUEST
            </button>
            <code
              className="text-xs px-3 py-2 rounded font-mono"
              style={{ background: "var(--forge-iron)", color: "var(--forge-faint)" }}
            >
              {formatBytes(IDENTITY_REQUEST)}
            </code>
          </div>
        )}

        {error && (
          <div
            className="p-4 rounded mb-6 font-mono text-sm"
            style={{ background: "rgba(255,80,80,0.12)", border: "1px solid #ff5050", color: "#ffb0b0" }}
          >
            {error}
          </div>
        )}

        {/* Reply panel */}
        {reply && <ReplyPanel reply={reply} />}

        {/* Activity log */}
        {access && (
          <div
            className="rounded p-4"
            style={{ background: "var(--forge-steel)", border: "1px solid var(--forge-border)" }}
          >
            <div className="flex items-center justify-between mb-3">
              <p
                className="text-xs font-mono"
                style={{ color: "var(--forge-muted)", letterSpacing: "0.15em" }}
              >
                ACTIVITY LOG
              </p>
              <button
                onClick={() => setLog([])}
                className="text-xs font-mono"
                style={{ color: "var(--forge-faint)" }}
              >
                clear
              </button>
            </div>
            <div
              ref={logRef}
              className="font-mono text-xs space-y-1 max-h-80 overflow-y-auto"
              style={{ color: "var(--forge-text)" }}
            >
              {log.length === 0 && (
                <p style={{ color: "var(--forge-faint)" }}>No activity yet.</p>
              )}
              {log.map((e, i) => (
                <div key={i} className="flex gap-3">
                  <span style={{ color: "var(--forge-faint)" }}>{e.ts}</span>
                  <span
                    className="w-10"
                    style={{
                      color:
                        e.dir === "in"
                          ? "var(--forge-arc)"
                          : e.dir === "out"
                          ? "var(--forge-ember)"
                          : e.dir === "error"
                          ? "#ff8080"
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
      </div>
    </div>
  );
}

/* ── Device picker ── */
function DevicePicker({
  label,
  hint,
  devices,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  devices: DeviceInfo[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div
      className="rounded p-4"
      style={{ background: "var(--forge-steel)", border: "1px solid var(--forge-border)" }}
    >
      <p
        className="text-xs font-mono mb-1"
        style={{ color: "var(--forge-arc)", letterSpacing: "0.15em" }}
      >
        {label}
      </p>
      <p className="text-xs font-mono mb-3" style={{ color: "var(--forge-faint)" }}>
        {hint}
      </p>
      {devices.length === 0 ? (
        <p className="text-sm font-mono" style={{ color: "var(--forge-muted)" }}>
          No devices found.
        </p>
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 rounded font-mono text-sm"
          style={{
            background: "var(--forge-iron)",
            color: "var(--forge-text)",
            border: "1px solid var(--forge-border)",
          }}
        >
          <option value="">— select —</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} {d.manufacturer ? `(${d.manufacturer})` : ""}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/* ── Reply panel ── */
function ReplyPanel({ reply }: { reply: IdentityReply }) {
  const line6 = isLine6(reply);
  return (
    <div
      className="rounded p-6 mb-6"
      style={{
        background: "var(--forge-steel)",
        border: `1px solid ${line6 ? "var(--forge-arc)" : "var(--forge-border)"}`,
        boxShadow: line6 ? "0 0 30px rgba(74,240,255,0.15)" : "none",
      }}
    >
      <div className="flex items-center gap-2 mb-4">
        <span
          className="text-xs font-mono px-2 py-1 rounded"
          style={{
            background: line6 ? "var(--forge-arc)" : "var(--forge-iron)",
            color: line6 ? "var(--forge-black)" : "var(--forge-muted)",
          }}
        >
          IDENTITY REPLY
        </span>
        {line6 && (
          <span className="text-xs font-mono" style={{ color: "var(--forge-arc)" }}>
            ✓ Line 6 device confirmed
          </span>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-4 font-mono text-sm">
        <Field label="Manufacturer" value={reply.manufacturerName} />
        <Field
          label="Manufacturer ID"
          value={reply.manufacturerId.map((b) => `0x${b.toString(16).padStart(2, "0")}`).join(" ")}
        />
        <Field label="Family Code" value={`0x${reply.familyCode.toString(16).padStart(4, "0")}`} />
        <Field label="Member Code" value={`0x${reply.memberCode.toString(16).padStart(4, "0")}`} />
        <Field label="Version" value={reply.versionString} />
        <Field label="Device ID" value={`0x${reply.deviceId.toString(16).padStart(2, "0")}`} />
      </div>

      <div className="mt-4">
        <p
          className="text-xs font-mono mb-2"
          style={{ color: "var(--forge-faint)", letterSpacing: "0.15em" }}
        >
          RAW
        </p>
        <code
          className="text-xs px-3 py-2 rounded block break-all"
          style={{ background: "var(--forge-iron)", color: "var(--forge-text)" }}
        >
          {formatBytes(reply.raw)}
        </code>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p
        className="text-xs mb-1"
        style={{ color: "var(--forge-faint)", letterSpacing: "0.1em" }}
      >
        {label}
      </p>
      <p style={{ color: "var(--forge-text)" }}>{value}</p>
    </div>
  );
}
