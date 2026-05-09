"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";

// ── Helix color palette (matches companion app colour names) ─────────────────
const HELIX_COLORS: Array<{ id: number; name: string; hex: string }> = [
  { id: 0,  name: "White",   hex: "#ffffff" },
  { id: 1,  name: "Red",     hex: "#ff3333" },
  { id: 2,  name: "Orange",  hex: "#ff6b00" },
  { id: 3,  name: "Yellow",  hex: "#ffcc00" },
  { id: 4,  name: "Green",   hex: "#33cc33" },
  { id: 5,  name: "Cyan",    hex: "#00cccc" },
  { id: 6,  name: "Blue",    hex: "#3366ff" },
  { id: 7,  name: "Violet",  hex: "#9933ff" },
  { id: 8,  name: "Pink",    hex: "#ff33cc" },
  { id: 9,  name: "Aqua",    hex: "#00ffcc" },
  { id: 10, name: "Lime",    hex: "#99ff00" },
  { id: 11, name: "Mint",    hex: "#66ffaa" },
];

// ── Visual Pedalboard component ──────────────────────────────────────────────
interface StompSlot { slot: number; label: string; color: number; }
interface PedalboardProps {
  stomps: StompSlot[];
  ip: string;
  devicePresetName: string;
  onStompsChange: (stomps: StompSlot[]) => void;
}

function Pedalboard({ stomps, ip, devicePresetName, onStompsChange }: PedalboardProps) {
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editColor, setEditColor] = useState(0);
  const [pushing, setPushing] = useState(false);
  const [pushStatus, setPushStatus] = useState("");
  const [captureMode, setCaptureMode] = useState(false);
  const [captureName, setCaptureName] = useState("");
  const [captureDesc, setCaptureDesc] = useState("");
  const [captureStatus, setCaptureStatus] = useState("");
  const [capturing, setCapturing] = useState(false);

  // Expand stomps to always show 8 slots (Helix standard layout)
  const maxSlot = Math.max(7, ...stomps.map(s => s.slot));
  const slots: StompSlot[] = Array.from({ length: maxSlot + 1 }, (_, i) => {
    const found = stomps.find(s => s.slot === i);
    return found ?? { slot: i, label: "", color: 0 };
  });

  function openEdit(slot: number) {
    const s = slots[slot];
    setEditLabel(s.label);
    setEditColor(s.color);
    setEditingSlot(slot);
  }

  function applyEdit() {
    if (editingSlot == null) return;
    const updated = slots.map(s =>
      s.slot === editingSlot ? { ...s, label: editLabel, color: editColor } : s
    ).filter(s => s.label || stomps.some(orig => orig.slot === s.slot));
    onStompsChange(updated);
    setEditingSlot(null);
  }

  async function pushToDevice() {
    setPushing(true);
    setPushStatus("Pushing…");
    try {
      const res = await fetch("/api/stadium/forge-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip,
          basePresetName: "",
          stomps: slots.filter(s => s.label),
          skipLoad: true,
        }),
      });
      const j = await res.json() as { ok: boolean; blobBytes?: number; error?: string };
      setPushStatus(j.ok ? `Pushed ${j.blobBytes}b` : `ERR: ${j.error}`);
    } catch (e) { setPushStatus(`ERR: ${String(e)}`); }
    finally { setPushing(false); }
  }

  async function doCapture() {
    if (!captureName.trim()) return;
    setCapturing(true);
    setCaptureStatus("Reading device…");
    try {
      const res = await fetch("/api/stadium/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, presetName: captureName.trim(), description: captureDesc.trim() }),
      });
      const j = await res.json() as {
        ok: boolean; id?: string; error?: string;
        snapshotCount?: number; stompCount?: number; blobBytes?: number; chainBlocks?: number;
      };
      if (j.ok) {
        setCaptureStatus(`Saved — ${j.blobBytes}b · ${j.chainBlocks} blocks · ${j.snapshotCount} snaps`);
        setCaptureMode(false);
      } else {
        setCaptureStatus(`ERR: ${j.error}`);
      }
    } catch (e) { setCaptureStatus(`ERR: ${String(e)}`); }
    finally { setCapturing(false); }
  }

  // Split into two rows of 4 (Helix-style layout)
  const rowA = slots.slice(0, 4);
  const rowB = slots.slice(4, 8);

  return (
    <div
      className="flex flex-col gap-3 px-3 py-3 rounded"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.1)" }}
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono tracking-widest opacity-40">PEDALBOARD</span>
        <button
          onClick={pushToDevice}
          disabled={pushing}
          className="ml-auto px-3 py-1 text-xs font-mono rounded"
          style={{ background: "rgba(255,107,26,0.15)", border: "1px solid rgba(255,107,26,0.4)", color: "#ff6b1a", opacity: pushing ? 0.5 : 1 }}
        >
          {pushing ? "…" : "WRITE TO DEVICE"}
        </button>
        <button
          onClick={() => {
            setCaptureName(devicePresetName || "Captured Preset");
            setCaptureDesc("");
            setCaptureStatus("");
            setCaptureMode(c => !c);
          }}
          className="px-3 py-1 text-xs font-mono rounded"
          style={{
            background: captureMode ? "rgba(74,222,128,0.18)" : "rgba(74,222,128,0.08)",
            border: `1px solid ${captureMode ? "rgba(74,222,128,0.6)" : "rgba(74,222,128,0.3)"}`,
            color: "#4ade80",
          }}
        >
          {captureMode ? "▾ CAPTURE" : "↓ CAPTURE TO LIBRARY"}
        </button>
      </div>

      {/* Capture form */}
      {captureMode && (
        <div
          className="flex flex-col gap-2 p-3 rounded"
          style={{ background: "rgba(74,222,128,0.05)", border: "1px solid rgba(74,222,128,0.2)" }}
        >
          <span className="text-xs font-mono tracking-widest" style={{ color: "#4ade80", opacity: 0.7 }}>CAPTURE CURRENT PRESET TO LIBRARY</span>
          <input
            value={captureName}
            onChange={e => setCaptureName(e.target.value)}
            placeholder="Preset name"
            className="px-2 py-1 text-sm font-mono rounded"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.2)", color: "white" }}
            autoFocus
            onKeyDown={e => { if (e.key === "Enter") doCapture(); if (e.key === "Escape") setCaptureMode(false); }}
          />
          <input
            value={captureDesc}
            onChange={e => setCaptureDesc(e.target.value)}
            placeholder="Description (optional)"
            className="px-2 py-1 text-sm font-mono rounded"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.2)", color: "white" }}
            onKeyDown={e => { if (e.key === "Enter") doCapture(); if (e.key === "Escape") setCaptureMode(false); }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={doCapture}
              disabled={capturing || !captureName.trim()}
              className="px-3 py-1 text-xs font-mono rounded font-bold"
              style={{ background: "#4ade80", color: "#000", opacity: capturing || !captureName.trim() ? 0.5 : 1 }}
            >
              {capturing ? "Saving…" : "SAVE TO LIBRARY"}
            </button>
            <button
              onClick={() => setCaptureMode(false)}
              className="px-3 py-1 text-xs font-mono rounded opacity-40"
              style={{ border: "1px solid rgba(255,255,255,0.2)" }}
            >
              CANCEL
            </button>
            {captureStatus && (
              <span className="text-xs font-mono ml-1" style={{ color: captureStatus.startsWith("ERR") ? "#f87171" : "#4ade80" }}>
                {captureStatus}
              </span>
            )}
          </div>
        </div>
      )}

      {pushStatus && (
        <div className="text-xs font-mono">
          <span style={{ color: pushStatus.startsWith("ERR") ? "#f87171" : "#4ade80" }}>{pushStatus}</span>
        </div>
      )}

      {/* Row A */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-mono opacity-25 tracking-widest">ROW A</span>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          {rowA.map((s) => <StompButton key={s.slot} slot={s} onEdit={openEdit} />)}
        </div>
      </div>

      {/* Row B */}
      {rowB.some(s => s) && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-mono opacity-25 tracking-widest">ROW B</span>
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {rowB.map((s) => <StompButton key={s.slot} slot={s} onEdit={openEdit} />)}
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editingSlot != null && (
        <div
          className="flex flex-col gap-3 p-3 rounded mt-1"
          style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.15)" }}
        >
          <span className="text-xs font-mono opacity-50">EDIT STOMP A.{editingSlot}</span>
          <input
            value={editLabel}
            onChange={e => setEditLabel(e.target.value.slice(0, 10))}
            placeholder="Label (max 10 chars)"
            className="px-2 py-1 text-sm font-mono rounded bg-transparent"
            style={{ border: "1px solid rgba(255,255,255,0.2)", color: "white" }}
            autoFocus
            onKeyDown={e => { if (e.key === "Enter") applyEdit(); if (e.key === "Escape") setEditingSlot(null); }}
          />
          <div className="flex flex-wrap gap-2">
            {HELIX_COLORS.map(c => (
              <button
                key={c.id}
                onClick={() => setEditColor(c.id)}
                title={c.name}
                className="rounded-full transition-transform"
                style={{
                  width: 20, height: 20,
                  background: c.hex,
                  outline: editColor === c.id ? `2px solid white` : "none",
                  outlineOffset: 2,
                  transform: editColor === c.id ? "scale(1.2)" : "scale(1)",
                }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={applyEdit}
              className="px-3 py-1 text-xs font-mono rounded"
              style={{ background: "#ff6b1a", color: "#000" }}
            >
              APPLY
            </button>
            <button
              onClick={() => setEditingSlot(null)}
              className="px-3 py-1 text-xs font-mono rounded opacity-40"
              style={{ border: "1px solid rgba(255,255,255,0.2)" }}
            >
              CANCEL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StompButton({ slot, onEdit }: { slot: StompSlot; onEdit: (n: number) => void }) {
  const color = HELIX_COLORS.find(c => c.id === slot.color) ?? HELIX_COLORS[0];
  const hasLabel = slot.label.length > 0;
  return (
    <button
      onClick={() => onEdit(slot.slot)}
      className="flex flex-col items-center justify-between rounded p-2 transition-all"
      style={{
        minHeight: 64,
        background: hasLabel ? `${color.hex}1a` : "rgba(255,255,255,0.03)",
        border: `1px solid ${hasLabel ? `${color.hex}66` : "rgba(255,255,255,0.1)"}`,
        cursor: "pointer",
      }}
      title={`Stomp A.${slot.slot} — click to edit`}
    >
      {/* LED indicator dot */}
      <div
        className="rounded-full"
        style={{ width: 8, height: 8, background: hasLabel ? color.hex : "rgba(255,255,255,0.1)", boxShadow: hasLabel ? `0 0 6px ${color.hex}` : "none" }}
      />
      {/* Label */}
      <span
        className="text-center font-mono leading-tight"
        style={{
          fontSize: 9,
          color: hasLabel ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.2)",
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          display: "block",
        }}
      >
        {slot.label || "—"}
      </span>
      {/* Slot number */}
      <span style={{ fontSize: 7, color: "rgba(255,255,255,0.2)" }}>A.{slot.slot}</span>
    </button>
  );
}

// ── Command Center component ─────────────────────────────────────────────────

interface MidiSlot {
  id: number;      // 1-6
  label: string;   // user display name
  channel: number; // 1-16
  cc: number;      // 0-127
  value: number;   // 0-127 (for instant) or min for toggle
  maxVal: number;  // 127 for instant; 0 for off toggle
  type: "cc" | "note" | "pc" | "none";
}

const DEFAULT_MIDI_SLOTS: MidiSlot[] = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1, label: `INSTANT ${i + 1}`, channel: 1, cc: 64 + i,
  value: 127, maxVal: 0, type: "cc" as const,
}));

function CommandCenter({ ip }: { ip: string }) {
  const [slots, setSlots] = useState<MidiSlot[]>(DEFAULT_MIDI_SLOTS);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editSlot, setEditSlot] = useState<MidiSlot | null>(null);
  const [status, setStatus] = useState("");
  const [fetching, setFetching] = useState(false);

  // Read MIDI instant CC values from device property API
  async function fetchMidi() {
    setFetching(true);
    setStatus("Reading…");
    const updates: Partial<Record<number, Partial<MidiSlot>>> = {};
    await Promise.all(DEFAULT_MIDI_SLOTS.map(async (s) => {
      const base = `preset.cmdcenter.inst.${s.id}`;
      try {
        const [rType, rCh, rCc, rVal] = await Promise.all([
          fetch(`/api/stadium/property?ip=${encodeURIComponent(ip)}&path=${encodeURIComponent(base + ".type")}`).then(r => r.json()),
          fetch(`/api/stadium/property?ip=${encodeURIComponent(ip)}&path=${encodeURIComponent(base + ".channel")}`).then(r => r.json()),
          fetch(`/api/stadium/property?ip=${encodeURIComponent(ip)}&path=${encodeURIComponent(base + ".cc")}`).then(r => r.json()),
          fetch(`/api/stadium/property?ip=${encodeURIComponent(ip)}&path=${encodeURIComponent(base + ".value")}`).then(r => r.json()),
        ]);
        updates[s.id] = {
          type: (rType.value as MidiSlot["type"]) ?? "none",
          channel: Number(rCh.value ?? 1),
          cc: Number(rCc.value ?? 0),
          value: Number(rVal.value ?? 127),
        };
      } catch { /* leave default */ }
    }));
    setSlots(prev => prev.map(s => ({ ...s, ...updates[s.id] })));
    setStatus(Object.keys(updates).length > 0 ? `Loaded ${Object.keys(updates).length} slots` : "No data — try DECODE PRESET first");
    setFetching(false);
  }

  async function writeSlot(s: MidiSlot) {
    setStatus(`Writing INSTANT ${s.id}…`);
    const base = `preset.cmdcenter.inst.${s.id}`;
    try {
      await Promise.all([
        fetch("/api/stadium/property", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ip, path: base + ".channel", value: s.channel }) }),
        fetch("/api/stadium/property", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ip, path: base + ".cc", value: s.cc }) }),
        fetch("/api/stadium/property", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ip, path: base + ".value", value: s.value }) }),
      ]);
      setStatus(`INSTANT ${s.id} written`);
    } catch (e) { setStatus(`ERR: ${String(e)}`); }
  }

  function openEdit(s: MidiSlot) { setEditSlot({ ...s }); setEditingId(s.id); }

  function applyEdit() {
    if (!editSlot) return;
    setSlots(prev => prev.map(s => s.id === editSlot.id ? editSlot : s));
    setEditingId(null);
    writeSlot(editSlot);
  }

  return (
    <div className="flex flex-col rounded" style={{ border: "1px solid rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.03)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b" style={{ borderColor: "rgba(251,191,36,0.15)" }}>
        <span className="text-xs font-mono tracking-widest" style={{ color: "#fbbf24" }}>COMMAND CENTER</span>
        <span className="text-xs opacity-30 font-mono">MIDI instant CC</span>
        <div className="ml-auto flex items-center gap-3">
          {status && <span className="text-xs font-mono opacity-60">{status}</span>}
          <button onClick={fetchMidi} disabled={fetching} className="px-3 py-1 text-xs font-mono rounded"
            style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.35)", color: "#fbbf24", opacity: fetching ? 0.5 : 1 }}>
            {fetching ? "…" : "READ DEVICE"}
          </button>
        </div>
      </div>

      {/* Slot grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-0">
        {slots.map((s, si) => (
          <button key={s.id} onClick={() => openEdit(s)}
            className="flex flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-all hover:bg-yellow-400/5"
            style={{ borderBottom: si < 3 ? "1px solid rgba(255,255,255,0.04)" : undefined, borderRight: si % 3 !== 2 ? "1px solid rgba(255,255,255,0.04)" : undefined }}>
            <div className="flex items-center gap-2 w-full">
              <span className="text-xs font-mono font-bold" style={{ color: "#fbbf24" }}>#{s.id}</span>
              <span className="text-xs font-mono truncate flex-1" style={{ color: s.type !== "none" ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.2)" }}>
                {s.label}
              </span>
            </div>
            <div className="text-xs font-mono opacity-40">
              {s.type === "none" ? "—" : `Ch${s.channel} · CC${s.cc} · ${s.value}`}
            </div>
          </button>
        ))}
      </div>

      {/* Inline editor */}
      {editingId != null && editSlot && (
        <div className="flex flex-col gap-3 px-4 py-3 border-t" style={{ borderColor: "rgba(251,191,36,0.15)", background: "rgba(0,0,0,0.2)" }}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono" style={{ color: "#fbbf24" }}>INSTANT {editSlot.id}</span>
            <input value={editSlot.label} maxLength={12}
              onChange={e => setEditSlot(p => p && { ...p, label: e.target.value })}
              placeholder="Name"
              className="px-2 py-1 text-xs font-mono rounded flex-1"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", color: "white" }}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-xs opacity-40 font-mono">CHANNEL</span>
              <input type="number" min={1} max={16} value={editSlot.channel}
                onChange={e => setEditSlot(p => p && { ...p, channel: Math.max(1, Math.min(16, parseInt(e.target.value) || 1)) })}
                className="px-2 py-1 text-xs font-mono rounded"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", color: "white" }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs opacity-40 font-mono">CC #</span>
              <input type="number" min={0} max={127} value={editSlot.cc}
                onChange={e => setEditSlot(p => p && { ...p, cc: Math.max(0, Math.min(127, parseInt(e.target.value) || 0)) })}
                className="px-2 py-1 text-xs font-mono rounded"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", color: "white" }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs opacity-40 font-mono">VALUE</span>
              <input type="number" min={0} max={127} value={editSlot.value}
                onChange={e => setEditSlot(p => p && { ...p, value: Math.max(0, Math.min(127, parseInt(e.target.value) || 0)) })}
                className="px-2 py-1 text-xs font-mono rounded"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", color: "white" }}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={applyEdit} className="px-3 py-1 text-xs font-mono rounded font-bold"
              style={{ background: "#fbbf24", color: "#000" }}>WRITE TO DEVICE</button>
            <button onClick={() => setEditingId(null)} className="px-3 py-1 text-xs font-mono rounded opacity-40"
              style={{ border: "1px solid rgba(255,255,255,0.2)" }}>CANCEL</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Msgpack field names packed as big-endian uint32:
// "id__" = 0x69645F5F, "eid_" = 0x6569645F, "mid_" = 0x6D69645F, "vals" = 0x76616C73
const K_ID   = 1768185695;
const K_EID  = 1701405791;
const K_MID  = 1835623519;
const K_VALS = 1986096243;

// Container CIDs (signed int32)
const CONTAINER_FACTORY  = -1;   // 0xFFFFFFFF
const CONTAINER_USER     = -2;   // 0xFFFFFFFE
const CONTAINER_SETLISTS = -5;   // 0xFFFFFFFB

interface PresetEntry { name: string; cid: number; }

type BrowserTab = "factory" | "user" | "setlists";

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
  const [cidInput, setCidInput] = useState("176");
  const [reqIdInput, setReqIdInput] = useState("105");
  const [loadStatus, setLoadStatus] = useState("");
  const [queryAddr, setQueryAddr] = useState("/GetContainerContents");
  const [queryTags, setQueryTags] = useState("i");
  const [queryArgs, setQueryArgs] = useState("1");
  const [queryResult, setQueryResult] = useState<string>("");
  const [queryPending, setQueryPending] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [replayFile, setReplayFile] = useState<RawEvent[] | null>(null);
  const [replayName, setReplayName] = useState("");
  const [replayStatus, setReplayStatus] = useState("");
  // preset browser
  const [browserTab, setBrowserTab] = useState<BrowserTab>("factory");
  const [browserPresets, setBrowserPresets] = useState<PresetEntry[]>([]);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserError, setBrowserError] = useState("");
  const [browserRaw, setBrowserRaw] = useState<string>("");
  const [activeCid, setActiveCid] = useState<number | null>(null);
  // setlist drill-down nav stack: [{cid, label}]
  const [browserCidStack, setBrowserCidStack] = useState<Array<{cid: number; label: string}>>([]);
  // device status
  const [deviceCid, setDeviceCid] = useState<number | null>(null);
  const [devicePresetName, setDevicePresetName] = useState("");
  const [snapshotIdx, setSnapshotIdx] = useState<number | null>(null);
  const [statusFetching, setStatusFetching] = useState(false);
  // decoded preset
  const [presetSnaps, setPresetSnaps] = useState<Array<{name: string; si__: number; colr: number}>>([]);
  const [presetSignalChain, setPresetSignalChain] = useState<Array<{slotIdx: number; block: unknown}>>([]);
  const [presetStomps, setPresetStomps] = useState<Array<{slot: number; label: string; color: number}>>([]);
  const [modelNames, setModelNames] = useState<Record<number, string>>({});
  const [editBlobB64, setEditBlobB64] = useState<string>("");
  const [pushStatus, setPushStatus] = useState("");
  // command center
  // pending forge import (from /forge "Send to Stadium")
  const [pendingImport, setPendingImport] = useState<{
    presetName: string; basePresetName: string; libraryPresetId?: string | null;
    snapshots: Array<{name: string}>; chain: string[]; description: string;
  } | null>(null);
  const [importStatus, setImportStatus] = useState("");
  const esRef = useRef<EventSource | null>(null);
  const paramsRef = useRef<Map<string, ParamEntry>>(new Map());
  const capturingRef = useRef(false);
  const capturedRef = useRef<RawEvent[]>([]);
  const browserPresetsRef = useRef<PresetEntry[]>([]);

  // Check for pending forge import on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem("helixforge_pending_import");
    if (!raw) return;
    try {
      const pending = JSON.parse(raw) as {
        presetName: string; basePresetName: string; libraryPresetId?: string | null;
        snapshots: Array<{name: string}>; chain: string[]; description: string;
        timestamp: number;
      };
      // Ignore stale imports (older than 10 minutes)
      if (Date.now() - pending.timestamp > 600_000) {
        localStorage.removeItem("helixforge_pending_import");
        return;
      }
      setPendingImport(pending);
    } catch { localStorage.removeItem("helixforge_pending_import"); }
  }, []);

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
          // Compact log: replace _b64 blobs with <b64 Nb> and _msgpack with decoded preview
          const compact = JSON.stringify(evt.data, (_, v) => {
            if (v && typeof v === "object" && "_b64" in v) return `<b64 ${(v as {_len:number})._len}b>`;
            if (v && typeof v === "object" && "_magic" in v) return `<${(v as {_magic:string})._magic}:${JSON.stringify((v as {_msgpack:unknown})._msgpack).slice(0,80)}>`;
            if (v && typeof v === "object" && "_msgpack" in v) return `<mp:${JSON.stringify((v as {_msgpack:unknown})._msgpack).slice(0,60)}>`;
            return v;
          }).slice(0, 200);
          appendLog(`[${evt.topic}${portLabel}] ${compact}`);
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

  const loadPresetByCid = useCallback(async (cid: number, reqId: number) => {
    setLoadStatus("sending…");
    try {
      const res = await fetch("/api/stadium/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, port: "2002", address: "/LoadPresetWithCID", typeTags: "ii", args: [reqId, cid] }),
      });
      const j = await res.json() as { ok: boolean; bytes?: number; error?: string };
      setLoadStatus(j.ok ? `sent ${j.bytes}b — watch event log` : `error: ${j.error}`);
    } catch (e) {
      setLoadStatus(`fetch error: ${String(e)}`);
    }
    setTimeout(() => setLoadStatus(""), 5000);
  }, [ip]);

  const loadFromBrowser = useCallback(async (entry: PresetEntry) => {
    setActiveCid(entry.cid);
    setDeviceCid(entry.cid);
    setDevicePresetName(entry.name);
    setCidInput(String(entry.cid));
    await loadPresetByCid(entry.cid, parseInt(reqIdInput, 10));
  }, [loadPresetByCid, reqIdInput]);

  // ── device status ───────────────────────────────────────────────────────────

  const fetchDeviceStatus = useCallback(async () => {
    setStatusFetching(true);
    try {
      const getP = (path: string) =>
        fetch(`/api/stadium/property?ip=${encodeURIComponent(ip)}&path=${encodeURIComponent(path)}`)
          .then(r => r.json() as Promise<{ ok: boolean; value?: unknown }>);

      const [jCid, jSnap] = await Promise.all([
        getP("server.active.preset.id"),
        getP("server.active.snapshot.index"),
      ]);

      if (jCid.ok && jCid.value !== undefined) {
        const cid = Number(jCid.value);
        if (!isNaN(cid)) {
          setDeviceCid(cid);
          setActiveCid(cid);
          const p = browserPresetsRef.current.find((x) => x.cid === cid);
          setDevicePresetName(p?.name ?? "");
        }
      }
      if (jSnap.ok && jSnap.value !== undefined) {
        const idx = Number(jSnap.value);
        if (!isNaN(idx)) setSnapshotIdx(idx);
      }

      // Fetch snapshot names from edit buffer independently (slower — don't block REFRESH UX)
      fetch(`/api/stadium/editbuffer?ip=${encodeURIComponent(ip)}`)
        .then(r => r.json() as Promise<{ ok: boolean; data?: unknown }>)
        .then(jBuf => {
          if (!jBuf.ok || !jBuf.data) return;
          const d = jBuf.data as Record<string, unknown>;
          const entt = (d?.['cg__'] as Record<string, unknown>)?.['entt'] as Record<string, unknown>;
          const snpsRaw = entt?.['snps'] as unknown[] | undefined;
          if (Array.isArray(snpsRaw) && snpsRaw.length > 0) {
            const snaps = snpsRaw
              .filter(s => s && typeof s === 'object')
              .map(s => {
                const so = s as Record<string, unknown>;
                return { name: String(so['name'] ?? ''), si__: Number(so['si__'] ?? 0), colr: Number(so['colr'] ?? 0) };
              })
              .sort((a, b) => a.si__ - b.si__);
            setPresetSnaps(snaps);
          }
        })
        .catch(() => { /* snapshots are optional */ });
    } catch { /* ignore */ } finally {
      setStatusFetching(false);
    }
  }, [ip]);

  const setSnapshotOnDevice = useCallback(async (index: number) => {
    setSnapshotIdx(index);
    await fetch("/api/stadium/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip, port: "2002", address: "/setSnapshot", typeTags: "ii", args: [parseInt(reqIdInput, 10), index] }),
    });
  }, [ip, reqIdInput]);

  // Command center is now self-contained in the CommandCenter component.

  const sendQuery = useCallback(async (address: string, typeTags: string, rawArgs: string) => {
    setQueryPending(true);
    setQueryResult("waiting…");
    try {
      const parsed = rawArgs.trim() === ""
        ? []
        : rawArgs.split(",").map((a) => {
            const n = Number(a.trim());
            return isNaN(n) ? a.trim() : n;
          });
      const res = await fetch("/api/stadium/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, port: "2002", address, typeTags, args: parsed, waitReply: true }),
      });
      const j = await res.json() as { ok: boolean; bytes?: number; reply?: unknown; replyRaw?: string; error?: string };
      if (!j.ok) { setQueryResult(`ERROR: ${j.error}`); return; }
      if (j.reply) {
        setQueryResult(JSON.stringify(j.reply, null, 2));
      } else if (j.replyRaw) {
        setQueryResult(`(no decode)\n${j.replyRaw}`);
      } else {
        setQueryResult("sent — no reply within 2s");
      }
    } catch (e) {
      setQueryResult(`fetch error: ${String(e)}`);
    } finally {
      setQueryPending(false);
    }
  }, [ip]);

  const fetchBrowserPresets = useCallback(async (tab: BrowserTab, overrideCid?: number) => {
    const cidMap: Record<BrowserTab, number> = {
      factory:  CONTAINER_FACTORY,
      user:     CONTAINER_USER,
      setlists: CONTAINER_SETLISTS,
    };
    const cid = overrideCid ?? cidMap[tab];
    setBrowserLoading(true);
    setBrowserError("");
    setBrowserPresets([]);
    setBrowserRaw("");
    try {
      const res = await fetch(`/api/stadium/contents?ip=${encodeURIComponent(ip)}&cid=${cid}`);
      const j = await res.json() as {
        ok: boolean;
        presets?: PresetEntry[];
        count?: number;
        error?: string;
        raw?: unknown;
      };
      if (!j.ok) {
        setBrowserError(j.error ?? "request failed");
        return;
      }
      const presets = j.presets ?? [];
      setBrowserPresets(presets);
      if (overrideCid === undefined) browserPresetsRef.current = presets;
      if (j.raw) setBrowserRaw(JSON.stringify(j.raw, null, 2).slice(0, 4000));
      if (presets.length === 0 && j.count === 0) {
        setBrowserError("empty container — device may not be in edit mode");
      }
      // update device preset name now that we have the list
      if (overrideCid === undefined && deviceCid !== null) {
        const p = presets.find((x) => x.cid === deviceCid);
        if (p) setDevicePresetName(p.name);
      }
    } catch (e) {
      setBrowserError(String(e));
    } finally {
      setBrowserLoading(false);
    }
  }, [ip, deviceCid]);

  const drillIntoBrowserEntry = useCallback(async (entry: PresetEntry) => {
    setBrowserCidStack(prev => [...prev, { cid: entry.cid, label: entry.name }]);
    await fetchBrowserPresets(browserTab, entry.cid);
  }, [fetchBrowserPresets, browserTab]);

  const browserNavBack = useCallback(async (toIndex: number) => {
    const newStack = browserCidStack.slice(0, toIndex);
    setBrowserCidStack(newStack);
    if (newStack.length === 0) {
      await fetchBrowserPresets(browserTab);
    } else {
      await fetchBrowserPresets(browserTab, newStack[newStack.length - 1].cid);
    }
  }, [browserCidStack, fetchBrowserPresets, browserTab]);

  const scanContainers = useCallback(async () => {
    setScanning(true);
    // Probe the known container CIDs (negative) plus a few positive IDs
    const probes: [string, number][] = [
      ["factory (-1)",  -1],
      ["user (-2)",     -2],
      ["cid -3",        -3],
      ["cid -4",        -4],
      ["setlists (-5)", -5],
      ["cid -6",        -6],
      ["cid -7",        -7],
      ["cid -8",        -8],
      ["cid 0",          0],
      ["cid 1",          1],
      ["cid 2",          2],
    ];
    setQueryResult(`scanning ${probes.length} container CIDs…`);
    const hits: string[] = [];
    for (const [label, cid] of probes) {
      try {
        const res = await fetch("/api/stadium/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ip, port: "2002", address: "/GetContainerContents", typeTags: "ii", args: [1, cid], waitReply: true }),
        });
        const j = await res.json() as { ok: boolean; reply?: { address: string; args: unknown[] } };
        if (j.ok && j.reply?.address === "/GetContainerContents") {
          const args = j.reply.args as [number, {_b64: string; _len: number}, number];
          const count = args[2] as number;
          const blen  = args[1]?._len ?? 0;
          hits.push(`${label}: count=${count} blobLen=${blen}`);
          setQueryResult(`scanning…\n${hits.join("\n")}`);
        }
      } catch { /* skip */ }
    }
    setQueryResult(hits.length > 0 ? `SCAN DONE:\n${hits.join("\n")}` : "scan done — no replies");
    setScanning(false);
  }, [ip]);

  const sendCmd = useCallback(async (address: string, typeTags: string, args: (number | string)[]) => {
    setSendStatus("sending…");
    try {
      const res = await fetch("/api/stadium/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, port: "2002", address, typeTags, args }),
      });
      const j = await res.json() as { ok: boolean; bytes?: number; error?: string };
      setSendStatus(j.ok ? `sent ${j.bytes}b` : `error: ${j.error}`);
    } catch (e) {
      setSendStatus(`fetch error: ${String(e)}`);
    }
    setTimeout(() => setSendStatus(""), 3000);
  }, [ip]);

  const loadReplayFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string) as RawEvent[];
        setReplayFile(data);
        setReplayName(file.name);
        setReplayStatus("");
      } catch {
        setReplayStatus("invalid JSON");
      }
    };
    reader.readAsText(file);
  }, []);

  const sendReplay = useCallback(async () => {
    if (!replayFile) return;
    setReplayStatus("replaying…");
    try {
      const res = await fetch("/api/stadium/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, port: "2002", events: replayFile }),
      });
      const j = await res.json() as { ok: boolean; sent?: number; total?: number; error?: string };
      setReplayStatus(j.ok ? `sent ${j.sent}/${j.total} cmds` : `error: ${j.error}`);
    } catch (e) {
      setReplayStatus(`fetch error: ${String(e)}`);
    }
    setTimeout(() => setReplayStatus(""), 5000);
  }, [replayFile, ip]);

  useEffect(() => () => { esRef.current?.close(); }, []);
  useEffect(() => { browserPresetsRef.current = browserPresets; }, [browserPresets]);
  useEffect(() => { if (status === "live") fetchDeviceStatus(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

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

        {/* pending forge import banner */}
        {pendingImport && (
          <div
            className="flex flex-col gap-2 px-4 py-3 rounded"
            style={{ background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.4)" }}
          >
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="text-xs font-mono tracking-widest" style={{ color: "#4ade80" }}>FORGE IMPORT READY</span>
                <span className="text-sm font-mono font-bold truncate">{pendingImport.presetName}</span>
                <span className="text-xs opacity-50 font-mono">Base: {pendingImport.basePresetName || "auto"} · Snapshots: {pendingImport.snapshots.map(s => s.name).join(", ")}</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={async () => {
                    setImportStatus("Applying to device…");
                    try {
                      const res = await fetch("/api/stadium/forge-apply", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          ip,
                          basePresetName: pendingImport.libraryPresetId ? "" : pendingImport.basePresetName,
                          libraryPresetId: pendingImport.libraryPresetId ?? undefined,
                          snapshots: pendingImport.snapshots,
                          skipLoad: !pendingImport.basePresetName && !pendingImport.libraryPresetId,
                        }),
                      });
                      const j = await res.json() as { ok: boolean; log?: string[]; error?: string; blobBytes?: number };
                      if (j.ok) {
                        setImportStatus(`Applied — ${j.blobBytes}b`);
                        setDevicePresetName(pendingImport.presetName);
                        localStorage.removeItem("helixforge_pending_import");
                        setPendingImport(null);
                      } else {
                        setImportStatus(`ERR: ${j.error}`);
                      }
                    } catch (e) { setImportStatus(`ERR: ${String(e)}`); }
                  }}
                  className="px-3 py-1.5 text-xs font-mono font-bold rounded"
                  style={{ background: "#4ade80", color: "#000" }}
                >
                  PUSH TO DEVICE
                </button>
                <button
                  onClick={() => {
                    localStorage.removeItem("helixforge_pending_import");
                    setPendingImport(null);
                    setImportStatus("");
                  }}
                  className="px-3 py-1.5 text-xs font-mono rounded opacity-40 hover:opacity-70"
                  style={{ border: "1px solid rgba(255,255,255,0.2)" }}
                >
                  DISMISS
                </button>
              </div>
            </div>
            {importStatus && (
              <span className="text-xs font-mono" style={{ color: importStatus.startsWith("ERR") ? "#f87171" : "#4ade80" }}>
                {importStatus}
              </span>
            )}
          </div>
        )}

        {/* device status + snapshot switcher */}
        <div
          className="flex flex-wrap items-center gap-3 px-4 py-2 rounded"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <span className="text-xs font-mono opacity-40 tracking-widest">DEVICE:</span>
          <span className="text-xs font-mono" style={{ color: "var(--forge-ember,#ff6b1a)" }}>
            {devicePresetName || (deviceCid !== null ? `CID ${deviceCid}` : "—")}
          </span>
          {deviceCid !== null && (
            <span className="text-xs font-mono opacity-30">#{deviceCid}</span>
          )}
          <div className="flex items-center gap-1 ml-2 flex-wrap">
            <span className="text-xs opacity-30 font-mono mr-1">SNAP:</span>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
              const snap = presetSnaps.find(s => s.si__ === i);
              const label = snap ? snap.name.slice(0, 11) : String(i + 1);
              const isActive = snapshotIdx === i;
              return (
                <button
                  key={i}
                  onClick={() => setSnapshotOnDevice(i)}
                  title={snap ? `${snap.name} — snapshot ${i}` : `Snapshot ${i + 1}`}
                  className="h-7 text-xs font-mono rounded transition-colors"
                  style={{
                    minWidth: snap ? "auto" : 28,
                    padding: snap ? "0 8px" : undefined,
                    width: snap ? undefined : 28,
                    ...(isActive
                      ? { background: "rgba(255,107,26,0.4)", border: "1px solid rgba(255,107,26,0.8)", color: "var(--forge-ember,#ff6b1a)" }
                      : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.5)" })
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <button
            onClick={fetchDeviceStatus}
            disabled={statusFetching}
            className="ml-auto px-3 py-1 text-xs font-mono tracking-widest rounded transition-colors"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.12)",
              opacity: statusFetching ? 0.5 : 1,
            }}
          >
            {statusFetching ? "…" : "REFRESH"}
          </button>
        </div>

        {/* visual pedalboard */}
        {presetStomps.length > 0 && (
          <Pedalboard
            stomps={presetStomps}
            ip={ip}
            devicePresetName={devicePresetName}
            onStompsChange={setPresetStomps}
          />
        )}

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

        {/* replay bar */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs opacity-40 font-mono">REPLAY:</span>
          <label
            className="px-3 py-1 text-xs font-mono tracking-widest rounded cursor-pointer"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)" }}
          >
            {replayName ? replayName.slice(0, 32) : "load capture…"}
            <input type="file" accept=".json" className="hidden" onChange={loadReplayFile} />
          </label>
          {replayFile && (
            <button
              onClick={sendReplay}
              className="px-3 py-1 text-xs font-mono tracking-widest rounded"
              style={{ background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.4)", color: "#4ade80" }}
            >
              ▶ SEND TO {ip}
            </button>
          )}
          {replayStatus && (
            <span className="text-xs font-mono" style={{ color: replayStatus.startsWith("error") || replayStatus === "invalid JSON" ? "#f87171" : "#4ade80" }}>
              {replayStatus}
            </span>
          )}
        </div>

        {/* load preset by CID */}
        <div
          className="flex flex-wrap items-center gap-3 px-4 py-3 rounded"
          style={{ background: "rgba(255,107,26,0.06)", border: "1px solid rgba(255,107,26,0.25)" }}
        >
          <span className="text-xs font-mono tracking-widest" style={{ color: "var(--forge-ember,#ff6b1a)" }}>LOAD PRESET:</span>
          <div className="flex items-center gap-1.5">
            <label className="text-xs opacity-50 font-mono">REQ ID</label>
            <input
              value={reqIdInput}
              onChange={(e) => setReqIdInput(e.target.value)}
              className="px-2 py-1 text-xs rounded font-mono w-16"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "inherit" }}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs opacity-50 font-mono">CID</label>
            <input
              value={cidInput}
              onChange={(e) => setCidInput(e.target.value)}
              className="px-2 py-1 text-xs rounded font-mono w-20"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "inherit" }}
            />
          </div>
          <button
            onClick={() => loadPresetByCid(parseInt(cidInput, 10), parseInt(reqIdInput, 10))}
            className="px-3 py-1 text-xs font-mono tracking-widest rounded"
            style={{ background: "rgba(255,107,26,0.2)", border: "1px solid rgba(255,107,26,0.6)", color: "var(--forge-ember,#ff6b1a)" }}
          >
            SEND /LoadPresetWithCID
          </button>
          <span className="text-xs opacity-40 font-mono">quick:</span>
          {([["Nashville", 176], ["Try 105", 105], ["Try 1", 1]] as [string, number][]).map(([name, cid]) => (
            <button
              key={cid}
              onClick={() => { setCidInput(String(cid)); loadPresetByCid(cid, parseInt(reqIdInput, 10)); }}
              className="px-2 py-1 text-xs font-mono rounded"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
            >
              {name} ({cid})
            </button>
          ))}
          {loadStatus && (
            <span className="text-xs font-mono ml-auto" style={{ color: loadStatus.startsWith("error") ? "#f87171" : "#4ade80" }}>
              {loadStatus}
            </span>
          )}
        </div>

        {/* preset browser */}
        <div
          className="flex flex-col rounded"
          style={{ border: "1px solid rgba(255,107,26,0.35)", background: "rgba(255,107,26,0.04)" }}
        >
          {/* browser header + tabs */}
          <div className="flex items-center gap-0 border-b" style={{ borderColor: "rgba(255,107,26,0.2)" }}>
            <span
              className="px-4 py-2 text-xs font-mono tracking-widest"
              style={{ color: "var(--forge-ember,#ff6b1a)" }}
            >
              PRESET BROWSER
            </span>
            <div className="flex ml-2">
              {(["factory", "user", "setlists"] as BrowserTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setBrowserTab(tab); setBrowserCidStack([]); fetchBrowserPresets(tab); }}
                  className="px-4 py-2 text-xs font-mono tracking-widest transition-colors"
                  style={
                    browserTab === tab
                      ? {
                          background: "rgba(255,107,26,0.22)",
                          borderBottom: "2px solid var(--forge-ember,#ff6b1a)",
                          color: "var(--forge-ember,#ff6b1a)",
                        }
                      : {
                          color: "rgba(255,255,255,0.35)",
                          borderBottom: "2px solid transparent",
                        }
                  }
                >
                  {tab.toUpperCase()}
                </button>
              ))}
            </div>
            {/* breadcrumb for drill-down */}
            {browserCidStack.length > 0 && (
              <div className="flex items-center gap-1 ml-3 text-xs font-mono">
                <button
                  onClick={() => browserNavBack(0)}
                  className="opacity-40 hover:opacity-80 transition-opacity"
                  style={{ color: "var(--forge-ember,#ff6b1a)" }}
                >
                  {browserTab.toUpperCase()}
                </button>
                {browserCidStack.map((crumb, ci) => (
                  <span key={ci} className="flex items-center gap-1">
                    <span className="opacity-25">/</span>
                    <button
                      onClick={() => browserNavBack(ci + 1)}
                      className="transition-opacity"
                      style={{
                        color: ci === browserCidStack.length - 1 ? "var(--forge-ember,#ff6b1a)" : undefined,
                        opacity: ci === browserCidStack.length - 1 ? 1 : 0.5,
                      }}
                    >
                      {crumb.label.slice(0, 20)}
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="ml-auto px-4 flex items-center gap-3">
              {browserPresets.length > 0 && (
                <span className="text-xs font-mono opacity-40">{browserPresets.length} items</span>
              )}
              <button
                onClick={() => browserCidStack.length > 0
                  ? fetchBrowserPresets(browserTab, browserCidStack[browserCidStack.length - 1].cid)
                  : fetchBrowserPresets(browserTab)
                }
                disabled={browserLoading}
                className="px-3 py-1.5 text-xs font-mono tracking-widest rounded transition-colors"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  opacity: browserLoading ? 0.5 : 1,
                }}
              >
                {browserLoading ? "LOADING…" : "FETCH"}
              </button>
            </div>
          </div>

          {/* browser body */}
          <div style={{ minHeight: 120, maxHeight: 280, overflowY: "auto" }}>
            {browserError && !browserLoading && (
              <div className="px-4 py-3 text-xs font-mono" style={{ color: "#f87171" }}>
                {browserError}
                {browserRaw && (
                  <details className="mt-2">
                    <summary className="cursor-pointer opacity-50">raw msgpack</summary>
                    <pre
                      className="mt-1 text-xs overflow-x-auto"
                      style={{ maxHeight: 160, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", opacity: 0.6 }}
                    >
                      {browserRaw}
                    </pre>
                  </details>
                )}
              </div>
            )}
            {browserLoading && (
              <div className="flex items-center justify-center h-24 text-xs font-mono opacity-40">
                querying device…
              </div>
            )}
            {!browserLoading && !browserError && browserPresets.length === 0 && (
              <div className="flex items-center justify-center h-24 text-xs font-mono opacity-30">
                click FETCH to load list
              </div>
            )}
            {!browserLoading && browserPresets.length > 0 && (
              <table className="w-full text-xs font-mono" style={{ borderCollapse: "collapse" }}>
                <tbody>
                  {browserPresets.map((p, i) => {
                    const isActive = p.cid === activeCid;
                    return (
                      <tr
                        key={p.cid}
                        style={{
                          borderBottom: "1px solid rgba(255,255,255,0.04)",
                          background: isActive ? "rgba(255,107,26,0.18)" : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                          cursor: "pointer",
                          transition: "background 0.15s",
                        }}
                        onClick={() => browserTab === "setlists" && browserCidStack.length < 2 ? drillIntoBrowserEntry(p) : loadFromBrowser(p)}
                      >
                        <td
                          className="px-3 py-1.5 text-right"
                          style={{ color: "rgba(255,255,255,0.25)", width: 48, userSelect: "none" }}
                        >
                          {i + 1}
                        </td>
                        <td
                          className="px-3 py-1.5"
                          style={{ color: isActive ? "var(--forge-ember,#ff6b1a)" : "inherit" }}
                        >
                          {p.name || <span style={{ opacity: 0.3 }}>(unnamed)</span>}
                        </td>
                        <td
                          className="px-3 py-1.5 text-right"
                          style={{ color: "rgba(255,255,255,0.2)", width: 60 }}
                        >
                          {p.cid}
                        </td>
                        <td className="px-3 py-1.5 text-right" style={{ width: 80 }}>
                          {browserTab === "setlists" && browserCidStack.length < 2 ? (
                            <button
                              className="px-2 py-0.5 rounded text-xs font-mono"
                              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)" }}
                              onClick={(e) => { e.stopPropagation(); drillIntoBrowserEntry(p); }}
                            >
                              OPEN →
                            </button>
                          ) : (
                            <button
                              className="px-2 py-0.5 rounded text-xs font-mono"
                              style={
                                isActive
                                  ? { background: "rgba(255,107,26,0.4)", border: "1px solid rgba(255,107,26,0.7)", color: "var(--forge-ember,#ff6b1a)" }
                                  : { background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)" }
                              }
                              onClick={(e) => { e.stopPropagation(); loadFromBrowser(p); }}
                            >
                              {isActive ? "✓" : "LOAD"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {/* show raw debug if extraction failed but raw exists */}
            {!browserLoading && browserPresets.length === 0 && browserRaw && (
              <details className="px-4 py-2">
                <summary className="text-xs font-mono cursor-pointer opacity-40">raw decoded msgpack</summary>
                <pre
                  className="mt-1 text-xs font-mono overflow-x-auto"
                  style={{
                    maxHeight: 200,
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    color: "#fbbf24",
                    opacity: 0.7,
                  }}
                >
                  {browserRaw}
                </pre>
              </details>
            )}
          </div>
        </div>

        {/* command center */}
        <CommandCenter ip={ip} />

        {/* signal chain viewer */}
        {presetSignalChain.length > 0 && (
          <div
            className="flex flex-col rounded"
            style={{ border: "1px solid rgba(74,222,128,0.25)", background: "rgba(74,222,128,0.03)" }}
          >
            <div
              className="flex items-center gap-3 px-4 py-2 border-b"
              style={{ borderColor: "rgba(74,222,128,0.12)" }}
            >
              <span className="text-xs font-mono tracking-widest" style={{ color: "#4ade80" }}>SIGNAL CHAIN</span>
              <span className="text-xs opacity-30 font-mono">{presetSignalChain.length} blocks</span>
              <button
                onClick={() => { setPresetSignalChain([]); setModelNames({}); }}
                className="ml-auto text-xs font-mono opacity-30 hover:opacity-70 transition-opacity"
              >
                CLEAR
              </button>
            </div>
            <div
              className="flex items-start gap-2 p-3 overflow-x-auto"
              style={{ scrollbarWidth: "thin" }}
            >
              {presetSignalChain.map(({ slotIdx, block }, bi) => {
                if (!block || typeof block !== "object") return null;
                const b = block as Record<string, unknown>;
                const mdls = b['mdls'] as Array<Record<string, unknown>> | undefined;
                const modelId = Array.isArray(mdls) && mdls.length > 0 ? (mdls[0]['id__'] as number) : null;
                const isBypassed = b['enbl'] === 0 || b['enbl'] === false;
                const isSnap = b['snap'] === true;
                const blockType = b['type'];
                const resolvedName = modelId != null ? modelNames[modelId] : undefined;
                const label = resolvedName ?? (modelId != null ? `mid:${modelId}` : blockType === 8 ? "INPUT" : `blk${slotIdx}`);
                const isResolved = resolvedName != null;
                return (
                  <div
                    key={bi}
                    className="flex-shrink-0 rounded flex flex-col gap-1 p-2"
                    style={{
                      minWidth: 80,
                      maxWidth: 120,
                      border: `1px solid ${isBypassed ? "rgba(255,255,255,0.1)" : "rgba(74,222,128,0.35)"}`,
                      background: isBypassed ? "rgba(255,255,255,0.02)" : "rgba(74,222,128,0.07)",
                      opacity: isBypassed ? 0.4 : 1,
                    }}
                  >
                    <div
                      className="text-xs font-mono text-center"
                      style={{ color: isResolved ? "#4ade80" : "#7db89e", fontSize: 10, wordBreak: "break-word", lineHeight: 1.3 }}
                      title={`slot:${slotIdx} model:${modelId ?? "?"}`}
                    >
                      {String(label)}
                    </div>
                    <div className="flex flex-col gap-0.5" style={{ fontSize: 9 }}>
                      <div style={{ color: "rgba(255,255,255,0.3)" }}>
                        s:{slotIdx} {isBypassed ? "BYP" : "ON"}{isSnap ? " 📸" : ""}
                      </div>
                      {Array.isArray(mdls) && mdls.length > 0 && (
                        <div style={{ color: "rgba(255,255,255,0.2)" }}>
                          {modelId != null ? `#${modelId}` : `p:${((mdls[0]['parm'] as unknown[]) ?? []).length}`}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* raw query console */}
        <div
          className="flex flex-col gap-2 px-4 py-3 rounded"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono tracking-widest opacity-50">QUERY:</span>
            <input
              value={queryAddr}
              onChange={(e) => setQueryAddr(e.target.value)}
              placeholder="/GetContainerContents"
              className="px-2 py-1 text-xs rounded font-mono flex-1"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "inherit", minWidth: 200 }}
            />
            <input
              value={queryTags}
              onChange={(e) => setQueryTags(e.target.value)}
              placeholder="tags e.g. ii"
              className="px-2 py-1 text-xs rounded font-mono w-20"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "inherit" }}
            />
            <input
              value={queryArgs}
              onChange={(e) => setQueryArgs(e.target.value)}
              placeholder="args e.g. 1,0"
              className="px-2 py-1 text-xs rounded font-mono w-28"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "inherit" }}
            />
            <button
              onClick={() => sendQuery(queryAddr, queryTags, queryArgs)}
              disabled={queryPending}
              className="px-3 py-1 text-xs font-mono tracking-widest rounded"
              style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)", opacity: queryPending ? 0.5 : 1 }}
            >
              {queryPending ? "…" : "SEND + READ"}
            </button>
            <button
              onClick={scanContainers}
              disabled={scanning}
              className="px-3 py-1 text-xs font-mono tracking-widest rounded"
              style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.4)", color: "#fbbf24", opacity: scanning ? 0.5 : 1 }}
            >
              {scanning ? "SCANNING…" : "SCAN CIDs"}
            </button>
            <button
              onClick={async () => {
                setQueryPending(true);
                setQueryResult("decoding edit buffer…");
                try {
                  const res = await fetch(`/api/stadium/editbuffer?ip=${encodeURIComponent(ip)}`);
                  const j = await res.json() as { ok: boolean; presetCid?: number; blobLen?: number; msgpackOffset?: number; prefix?: string; rawBlob?: string; data?: unknown; error?: string; hex64?: string };
                  if (!j.ok) {
                    setQueryResult(`ERROR: ${j.error}\nhex: ${j.hex64 ?? "none"}`);
                  } else {
                    // Store raw blob for round-trip write
                    if (j.rawBlob) setEditBlobB64(j.rawBlob);
                    // Extract named snapshots from cg__.entt.snps
                    try {
                      const d = j.data as Record<string, unknown>;
                      const entt = (d?.['cg__'] as Record<string, unknown>)?.['entt'] as Record<string, unknown>;
                      const snpsRaw = entt?.['snps'] as unknown[] | undefined;
                      if (Array.isArray(snpsRaw) && snpsRaw.length > 0) {
                        const snaps = snpsRaw
                          .filter(s => s && typeof s === 'object')
                          .map(s => {
                            const so = s as Record<string, unknown>;
                            return { name: String(so['name'] ?? ''), si__: Number(so['si__'] ?? 0), colr: Number(so['colr'] ?? 0) };
                          })
                          .sort((a, b) => a.si__ - b.si__);
                        setPresetSnaps(snaps);
                      }
                    } catch { /* ignore — snapshots optional */ }
                    // Extract signal chain from sfg_.flow[0].blks (alternating [slot_idx, blockObj, ...])
                    try {
                      const d = j.data as Record<string, unknown>;
                      const flowArr = (d?.['sfg_'] as Record<string, unknown>)?.['flow'] as unknown[] | undefined;
                      if (Array.isArray(flowArr) && flowArr.length > 0) {
                        const path0 = flowArr[0] as Record<string, unknown>;
                        const blks = path0?.['blks'] as unknown[] | undefined;
                        if (Array.isArray(blks)) {
                          // blks alternates: [slot_idx, blockObj, slot_idx, blockObj, ...]
                          const pairs: Array<{slotIdx: number; block: unknown}> = [];
                          for (let bi = 0; bi + 1 < blks.length; bi += 2) {
                            pairs.push({ slotIdx: Number(blks[bi]), block: blks[bi + 1] });
                          }
                          setPresetSignalChain(pairs);
                          // Resolve model names from .hsp file correlation
                          const slotPayload = pairs.flatMap(({ slotIdx, block }) => {
                            const b = block as Record<string, unknown>;
                            const mdls = b?.['mdls'] as Array<Record<string, unknown>> | undefined;
                            const modelId = Array.isArray(mdls) && mdls.length > 0 ? mdls[0]['id__'] as number : null;
                            return modelId != null ? [{ slot: slotIdx, modelId }] : [];
                          });
                          if (slotPayload.length > 0 && devicePresetName) {
                            fetch("/api/stadium/resolve-models", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ presetName: devicePresetName, slots: slotPayload }),
                            }).then(r => r.json()).then((nm: { ok: boolean; names?: Record<number, string> }) => {
                              if (nm.ok && nm.names) setModelNames(nm.names);
                            }).catch(() => { /* non-critical */ });
                          }
                        }
                      }
                    } catch { /* ignore */ }
                    // Extract stomp footswitch labels from pm__
                    try {
                      const d = j.data as Record<string, unknown>;
                      const pm = d?.['pm__'] as unknown[] | undefined;
                      if (Array.isArray(pm)) {
                        const slotMap = new Map<number, {label: string; color: number}>();
                        for (const entry of pm) {
                          if (!entry || typeof entry !== 'object') continue;
                          const e = entry as Record<string, unknown>;
                          const key = String(e['key_'] ?? '');
                          const val = e['val_'];
                          const lm = key.match(/^preset\.floorboard\.stomp\.a\.(\d+)\.label$/);
                          if (lm) {
                            const s = parseInt(lm[1], 10);
                            slotMap.set(s, { label: String(val ?? ''), color: slotMap.get(s)?.color ?? 1 });
                          }
                          const cm = key.match(/^preset\.floorboard\.stomp\.a\.(\d+)\.color$/);
                          if (cm) {
                            const s = parseInt(cm[1], 10);
                            slotMap.set(s, { label: slotMap.get(s)?.label ?? '', color: Number(val ?? 1) });
                          }
                        }
                        setPresetStomps(
                          [...slotMap.entries()]
                            .map(([slot, v]) => ({ slot, ...v }))
                            .sort((a, b) => a.slot - b.slot)
                        );
                      }
                    } catch { /* ignore */ }
                    setQueryResult(
                      `presetCid: ${j.presetCid}  blobLen: ${j.blobLen}  msgpackOffset: ${j.msgpackOffset}  prefix: ${j.prefix ?? "none"}\n\n` +
                      JSON.stringify(j.data, null, 2)
                    );
                  }
                } catch (e) {
                  setQueryResult(`fetch error: ${String(e)}`);
                } finally {
                  setQueryPending(false);
                }
              }}
              disabled={queryPending}
              className="px-3 py-1 text-xs font-mono tracking-widest rounded"
              style={{ background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.35)", color: "#4ade80", opacity: queryPending ? 0.5 : 1 }}
            >
              DECODE PRESET
            </button>
            {editBlobB64 && (
              <button
                onClick={async () => {
                  setPushStatus("pushing…");
                  try {
                    const res = await fetch(`/api/stadium/editbuffer`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ ip, rawBlob: editBlobB64 }),
                    });
                    const j = await res.json() as { ok: boolean; bytes?: number; blobBytes?: number; reply?: unknown; error?: string };
                    setPushStatus(j.ok ? `pushed ${j.blobBytes}b → reply: ${j.reply ? JSON.stringify(j.reply).slice(0, 60) : "none"}` : `ERR: ${j.error}`);
                  } catch (e) {
                    setPushStatus(String(e));
                  }
                  setTimeout(() => setPushStatus(""), 8000);
                }}
                disabled={queryPending}
                className="px-3 py-1 text-xs font-mono tracking-widest rounded"
                style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.4)", color: "#fbbf24", opacity: queryPending ? 0.5 : 1 }}
              >
                PUSH TO DEVICE
              </button>
            )}
            {pushStatus && (
              <span className="text-xs font-mono" style={{ color: pushStatus.startsWith("ERR") ? "#f87171" : "#4ade80", maxWidth: 320 }}>
                {pushStatus}
              </span>
            )}
            <span className="text-xs opacity-40 font-mono">quick:</span>
            {([
              ["/ProductInfoGet",        "i",  "1"],
              ["/EditBufferStateGet",    "i",  "1"],
              ["/GetContainerContents",  "ii", "1,-1"],
              ["/GetContainerContents",  "ii", "1,-2"],
              ["/GetContentRef",         "ii", "1,-1"],
              ["/PropertyValueGet",      "is", "1,server.active.preset.id"],
            ] as [string, string, string][]).map(([addr, tags, args], qi) => (
              <button
                key={qi}
                onClick={() => { setQueryAddr(addr); setQueryTags(tags); setQueryArgs(args); sendQuery(addr, tags, args); }}
                className="px-2 py-1 text-xs font-mono rounded opacity-60 hover:opacity-100"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                {addr.replace("/Get","").replace("/","")}{args !== "1" ? ` (${args})` : ""}
              </button>
            ))}
          </div>
          {queryResult && (
            <pre
              className="text-xs font-mono p-3 rounded overflow-x-auto"
              style={{
                background: "rgba(0,0,0,0.4)",
                border: "1px solid rgba(255,255,255,0.06)",
                color: queryResult.startsWith("ERROR") ? "#f87171" : "#4ade80",
                maxHeight: 240,
                overflowY: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {queryResult}
            </pre>
          )}
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
