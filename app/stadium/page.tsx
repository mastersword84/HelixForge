"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import modelDefsRaw from "@/lib/helix-model-defs.json";
import allModelsRaw from "@/lib/helix-all-models.json";

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

// ── Block category → color + abbreviation ─────────────────────────────────────
function getBlockCat(label: string): { border: string; bg: string; abbr: string } {
  const l = label.toLowerCase();
  if (l === "input")  return { border: "#4a4a6a", bg: "#0e0e1a", abbr: "IN" };
  if (l === "output") return { border: "#4a4a6a", bg: "#0e0e1a", abbr: "OUT" };
  if (/\bamp\b|twin|deluxe|princeton|plexi|jcm|mesa|marshall|vox|ac\d|fender|friedman|matchless|dumble|rectif/i.test(l))
    return { border: "#e03030", bg: "#200808", abbr: "AMP" };
  if (/\bcab\b/i.test(l))
    return { border: "#b04820", bg: "#180c05", abbr: "CAB" };
  if (/dist|fuzz|drive|overdrive|boost|screamer|rat\b|klon|muff/i.test(l))
    return { border: "#c06010", bg: "#180e03", abbr: "DIST" };
  if (/delay|echo|slapback/i.test(l))
    return { border: "#20c070", bg: "#061a0e", abbr: "DLY" };
  if (/reverb|plate|hall|spring|room|cathedral/i.test(l))
    return { border: "#20a0c0", bg: "#061318", abbr: "REV" };
  if (/chorus/i.test(l))
    return { border: "#4060e0", bg: "#08081e", abbr: "CHO" };
  if (/flanger/i.test(l))
    return { border: "#6040c0", bg: "#0e0818", abbr: "FLG" };
  if (/phaser/i.test(l))
    return { border: "#8030b0", bg: "#120814", abbr: "PHS" };
  if (/pitch|octav|whammy|harmony/i.test(l))
    return { border: "#9030c0", bg: "#14081c", abbr: "PCH" };
  if (/wah|filter/i.test(l))
    return { border: "#c0a000", bg: "#181200", abbr: "WAH" };
  if (/compressor|comp\b|dynamics/i.test(l))
    return { border: "#40a040", bg: "#081408", abbr: "CMP" };
  if (/\beq\b/i.test(l))
    return { border: "#4070c0", bg: "#080e18", abbr: "EQ" };
  if (/tremolo|trem\b/i.test(l))
    return { border: "#c040a0", bg: "#180810", abbr: "TRM" };
  if (/volume|vol\b/i.test(l))
    return { border: "#606090", bg: "#0c0c16", abbr: "VOL" };
  if (/looper/i.test(l))
    return { border: "#00b060", bg: "#001a0c", abbr: "LP" };
  return { border: "#3a3a5a", bg: "#0e0e1a", abbr: "FX" };
}

// ── Catalog model helpers ─────────────────────────────────────────────────────
interface CatalogModel { id: string; name: string; abbr: string; cat: string; border: string; bg: string; img: string | null; }

const MODEL_DEFS = modelDefsRaw as Record<string, { name: string; short: string; cls: string; img: string | null }>;

// Official cat abbreviation → getBlockCat hint
const CAT_HINT: Record<string, string> = {
  AMP: 'amp', PRE: 'amp', CAB: 'cab', DIST: 'dist', DLY: 'delay',
  REV: 'reverb', MOD: 'chorus', DYN: 'compressor', EQ: 'eq',
  PCH: 'pitch', WAH: 'wah', VOL: 'volume', LP: 'looper',
  FXL: 'fx loop', IN: 'input', OUT: 'output', SPL: 'fx', MRG: 'fx',
};

function lookupDef(id: string) {
  return MODEL_DEFS[id]
    ?? MODEL_DEFS[id.replace(/Stereo$/, 'Mono')]
    ?? MODEL_DEFS[id.replace(/Mono$/, 'Stereo')]
    ?? null;
}

function modelDisplayName(id: string): string {
  const d = lookupDef(id);
  if (d) return d.name;
  let s = id.replace(/^(HD2_|Agoura_|VIC_|HX2_|P35_|EPIC_)/, '');
  s = s.replace(/(Mono|Stereo)$/, '');
  const strips = ['CabMicIr','Cab','AmpCab','Amp','Dist','Delay','DL4','Reverb','Chorus','Phaser','Flanger','Pitch','VolPan','Vol','Dyn','EQ','Eq','Gate','Wah','Filter'];
  for (const p of strips) { if (s.startsWith(p)) { s = s.slice(p.length); break; } }
  return s.replace(/([A-Z][a-z]+)/g,' $1').replace(/([A-Z]+)(?=[A-Z][a-z])/g,' $1').replace(/([a-z])(\d)/g,'$1 $2').replace(/(\d)([A-Z])/g,'$1 $2').trim() || id;
}

const ALL_MODELS: CatalogModel[] = (allModelsRaw as Array<{ id: string; name: string; short: string; cat: string; abbr: string; img: string | null }>)
  .map(m => {
    const hint = CAT_HINT[m.abbr] ?? m.name;
    const info = getBlockCat(hint);
    // For AMP/PRE use the abbr override so they stay distinct
    const abbr = m.abbr;
    return { id: m.id, name: m.name, abbr, cat: m.cat, border: info.border, bg: info.bg, img: m.img };
  });

// ── Visual Pedalboard component ──────────────────────────────────────────────
interface StompSlot {
  slot: number;
  label: string;
  color: number;
  model?: string;       // catalog key e.g. "HD2_DistScream808Mono"
  midiEnabled?: boolean;
  midiCC?: number;      // 0-127
  midiCh?: number;      // 1-16
  midiMin?: number;     // 0-127
  midiMax?: number;     // 0-127
}
interface BlockInfo { slot: number; model: string; name: string; type: string; }
interface PedalboardProps {
  stomps: StompSlot[];
  ip: string;
  devicePresetName: string;
  stompMap: { bankA: BlockInfo[]; bankB: BlockInfo[] } | null;
  onStompsChange: (stomps: StompSlot[]) => void;
}

function Pedalboard({ stomps, ip, devicePresetName, stompMap, onStompsChange }: PedalboardProps) {
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [pickerTab, setPickerTab] = useState<'block'|'midi'|'label'>('block');
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerCat, setPickerCat] = useState('ALL');
  const [draft, setDraft] = useState<StompSlot | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushStatus, setPushStatus] = useState("");
  const [captureMode, setCaptureMode] = useState(false);
  const [captureName, setCaptureName] = useState("");
  const [captureDesc, setCaptureDesc] = useState("");
  const [captureStatus, setCaptureStatus] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [stompBank, setStompBank] = useState<'a'|'b'>('a');

  // stomp.a.1-12 → slots 1-12 (11+12 are fixed buttons, shown as static UI)
  // stomp.b.1-12 → slots 13-24 (bankOffset=12 avoids collision)
  const maxSlot = Math.max(24, ...stomps.map(s => s.slot));
  const slots: StompSlot[] = Array.from({ length: maxSlot + 1 }, (_, i) => {
    const found = stomps.find(s => s.slot === i);
    return found ?? { slot: i, label: "", color: 0 };
  });

  function openPicker(slot: number) {
    setDraft({ ...slots[slot] });
    setPickerTab('block');
    setPickerSearch('');
    setPickerCat('ALL');
    setPickerSlot(slot);
  }

  function applyPicker() {
    if (pickerSlot == null || !draft) return;
    const updated = slots.map(s => s.slot === pickerSlot ? { ...draft } : s)
      .filter(s => s.label || s.model || stomps.some(o => o.slot === s.slot));
    onStompsChange(updated);
    setPickerSlot(null);
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

  // STOMP A: stomp.a.1-10 → slots 1-10  (11/12 are fixed, rendered as static UI)
  // STOMP B: stomp.b.1-12 → slots 13-24 (bankOffset=12)
  const off = stompBank === 'a' ? 0 : 12;
  const row1 = slots.filter(s => s.slot >= 1+off  && s.slot <= 5+off);
  const row2 = slots.filter(s => s.slot >= 6+off  && s.slot <= 10+off);

  // blockForSlot: given a physical stomp slot number, return the signal-chain block it controls.
  // Bank A: slot 1-10 → stompMap.bankA[0..9]; Bank B: slot 13-22 → stompMap.bankB[0..9]
  const blockForSlot = (stompSlot: number): BlockInfo | undefined => {
    if (!stompMap) return undefined;
    if (stompSlot >= 1 && stompSlot <= 10)   return stompMap.bankA[stompSlot - 1];
    if (stompSlot >= 13 && stompSlot <= 22)  return stompMap.bankB[stompSlot - 13];
    return undefined;
  };

  return (
    <div
      className="flex flex-col gap-4 px-4 py-4 rounded-xl"
      style={{ background: "#0d0d16", border: "1px solid #1e1e30" }}
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono tracking-widest" style={{ color: "#5a5a80" }}>STOMP SWITCHES</span>
        {/* A / B bank toggle */}
        <div className="flex rounded overflow-hidden" style={{ border: "1px solid #2a2a3a" }}>
          {(['a','b'] as const).map(bank => (
            <button
              key={bank}
              onClick={() => setStompBank(bank)}
              className="px-3 py-0.5 text-xs font-mono font-bold tracking-widest"
              style={stompBank === bank
                ? { background: "rgba(255,107,26,0.25)", color: "#ff6b1a" }
                : { background: "transparent", color: "rgba(255,255,255,0.25)" }}
            >
              {bank.toUpperCase()}
            </button>
          ))}
        </div>
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

      {/* Active bank — 2 rows of 5 + fixed buttons */}
      <div className="flex flex-col gap-2">
        {/* Top row + TAP/STOMP/PRESET */}
        <div className="flex gap-2">
          <div className="grid gap-2 flex-1" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
            {row2.map((s) => <StompButton key={s.slot} slot={s} block={blockForSlot(s.slot)} onEdit={openPicker} />)}
          </div>
          <div className="flex flex-col items-center rounded justify-between" style={{
            minHeight: 96, minWidth: 80, padding: "8px 4px 7px", gap: 5,
            background: "linear-gradient(180deg, #16161f 0%, #0e0e16 100%)",
            border: "1px solid #3a2a1a", boxShadow: "0 0 14px rgba(255,107,26,0.08), inset 0 1px 0 rgba(255,255,255,0.03)",
            flexShrink: 0,
          }}>
            <div style={{ width: 30, height: 30, borderRadius: 7, background: "radial-gradient(135deg, #1e1410, #0e0a06)", border: "1.5px solid #ff6b1a55", boxShadow: "0 0 8px rgba(255,107,26,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, color: "#ff6b1a" }}>⬡</span>
            </div>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff6b1a", boxShadow: "0 0 7px 2px rgba(255,107,26,0.5)" }} />
            <span style={{ fontSize: 6.5, fontFamily: "monospace", letterSpacing: "0.04em", color: "rgba(255,107,26,0.7)", textAlign: "center", lineHeight: 1.3 }}>TAP<br/>STOMP<br/>PRESET</span>
          </div>
        </div>
        {/* Bottom row + TUNER */}
        <div className="flex gap-2">
          <div className="grid gap-2 flex-1" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
            {row1.map((s) => <StompButton key={s.slot} slot={s} block={blockForSlot(s.slot)} onEdit={openPicker} />)}
          </div>
          <div className="flex flex-col items-center rounded justify-between" style={{
            minHeight: 96, minWidth: 80, padding: "8px 4px 7px", gap: 5,
            background: "linear-gradient(180deg, #16161f 0%, #0e0e16 100%)",
            border: "1px solid #1a2a3a", boxShadow: "0 0 14px rgba(0,200,255,0.06), inset 0 1px 0 rgba(255,255,255,0.03)",
            flexShrink: 0,
          }}>
            <div style={{ width: 30, height: 30, borderRadius: 7, background: "radial-gradient(135deg, #0e141e, #060a0e)", border: "1.5px solid #00ccff44", boxShadow: "0 0 8px rgba(0,200,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 700, color: "#00ccff" }}>𝄞</span>
            </div>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#00ccff", boxShadow: "0 0 7px 2px rgba(0,200,255,0.4)" }} />
            <span style={{ fontSize: 7.5, fontFamily: "monospace", letterSpacing: "0.05em", color: "rgba(0,200,255,0.7)", textAlign: "center", lineHeight: 1.2 }}>TUNER</span>
          </div>
        </div>
      </div>

      {/* Stomp Picker */}
      {pickerSlot != null && draft && (() => {
        const cats = ['ALL','AMP','PRE','CAB','DIST','DLY','REV','MOD','DYN','EQ','PCH','WAH','VOL','LP','FXL'];
        const filtered = ALL_MODELS.filter(m => {
          const catOk = pickerCat === 'ALL' || m.abbr === pickerCat;
          const searchOk = !pickerSearch || m.name.toLowerCase().includes(pickerSearch.toLowerCase()) || m.id.toLowerCase().includes(pickerSearch.toLowerCase());
          // Hide input/output/split/merge from picker by default unless searched
          const notInternal = pickerSearch || !['IN','OUT','SPL','MRG'].includes(m.abbr);
          return catOk && searchOk && notInternal;
        });
        return (
          <div
            className="flex flex-col rounded-xl overflow-hidden"
            style={{ background: "#0a0a14", border: "1px solid #ff6b1a55", boxShadow: "0 0 24px rgba(255,107,26,0.12)" }}
          >
            {/* Picker header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: "#1a1a28", background: "#0d0d18" }}>
              <span className="text-xs font-mono tracking-widest" style={{ color: "#ff6b1a" }}>
                {pickerSlot != null && pickerSlot <= 12
                  ? `STOMP A · ${pickerSlot}`
                  : pickerSlot != null
                  ? `STOMP B · ${pickerSlot - 12}`
                  : ""} ASSIGN
              </span>
              <div className="flex gap-1 ml-2">
                {(['block','midi','label'] as const).map(t => (
                  <button key={t} onClick={() => setPickerTab(t)}
                    className="px-2 py-0.5 text-xs font-mono rounded tracking-widest"
                    style={pickerTab === t
                      ? { background: "rgba(255,107,26,0.25)", border: "1px solid #ff6b1a", color: "#ff6b1a" }
                      : { background: "transparent", border: "1px solid #2a2a3a", color: "rgba(255,255,255,0.35)" }}
                  >
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>
              <button onClick={() => setPickerSlot(null)} className="ml-auto text-xs font-mono opacity-30 hover:opacity-70">✕</button>
            </div>

            {/* BLOCK tab */}
            {pickerTab === 'block' && (
              <div className="flex flex-col gap-2 p-3">
                {/* Category chips */}
                <div className="flex flex-wrap gap-1">
                  {cats.map(c => (
                    <button key={c} onClick={() => setPickerCat(c)}
                      className="px-2 py-0.5 text-xs font-mono rounded"
                      style={pickerCat === c
                        ? { background: "rgba(255,107,26,0.25)", border: "1px solid #ff6b1a55", color: "#ff6b1a" }
                        : { background: "rgba(255,255,255,0.04)", border: "1px solid #1e1e2e", color: "rgba(255,255,255,0.35)" }}
                    >{c}</button>
                  ))}
                  {draft.model && (
                    <button onClick={() => setDraft({ ...draft, model: undefined })}
                      className="px-2 py-0.5 text-xs font-mono rounded ml-2"
                      style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171" }}
                    >CLEAR</button>
                  )}
                </div>
                {/* Search */}
                <input
                  value={pickerSearch}
                  onChange={e => setPickerSearch(e.target.value)}
                  placeholder="Search models…"
                  autoFocus
                  className="px-2 py-1 text-xs font-mono rounded"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "white" }}
                />
                {/* Model grid */}
                <div className="overflow-y-auto" style={{ maxHeight: 520 }}>
                  <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
                    {filtered.map(m => {
                      const isSelected = draft.model === m.id;
                      return (
                        <button
                          key={m.id}
                          onClick={() => setDraft({ ...draft, model: m.id, label: draft.label || m.name.slice(0, 10) })}
                          className="flex flex-col items-center rounded transition-all"
                          style={{
                            width: 140, height: 140, borderRadius: 22,
                            background: isSelected ? m.bg : "rgba(255,255,255,0.02)",
                            border: `2px solid ${isSelected ? m.border : "#1e1e2e"}`,
                            boxShadow: isSelected
                              ? `0 0 28px ${m.border}66, inset 0 0 36px ${m.border}0c`
                              : "none",
                            display: "flex", flexDirection: "column",
                            alignItems: "center", justifyContent: "center", gap: 6,
                            padding: "10px 8px 12px",
                          }}
                          title={m.id}
                        >
                          <div style={{
                            width: 116, height: 116, borderRadius: 18,
                            background: m.img ? "#0a0a14" : m.bg,
                            border: `2px solid ${isSelected ? m.border : m.border + "55"}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            overflow: "hidden", flexShrink: 0,
                          }}>
                            {m.img
                              ? <img src={`/helix-icons/${m.img}`} alt={m.name} style={{ width: 100, height: 100, objectFit: "contain" }} />
                              : <span style={{ fontSize: 18, fontFamily: "monospace", fontWeight: "bold", color: m.border }}>{m.abbr}</span>
                            }
                          </div>
                          <span style={{
                            fontSize: 11, fontWeight: 600, fontFamily: "monospace", textAlign: "center",
                            color: isSelected ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.5)",
                            lineHeight: 1.2, maxWidth: 130, overflow: "hidden",
                            textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block",
                          }}>
                            {m.name || m.id}
                          </span>
                        </button>
                      );
                    })}
                    {filtered.length === 0 && (
                      <div className="col-span-full text-xs font-mono opacity-30 py-4 text-center">no matches</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* MIDI tab */}
            {pickerTab === 'midi' && (
              <div className="flex flex-col gap-3 p-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <div
                    onClick={() => setDraft({ ...draft, midiEnabled: !draft.midiEnabled })}
                    style={{
                      width: 36, height: 20, borderRadius: 10, transition: "all 0.2s",
                      background: draft.midiEnabled ? "#4ade80" : "#2a2a3a",
                      position: "relative", flexShrink: 0, cursor: "pointer",
                    }}
                  >
                    <div style={{
                      position: "absolute", top: 3, left: draft.midiEnabled ? 18 : 3,
                      width: 14, height: 14, borderRadius: "50%", background: "white",
                      transition: "left 0.2s",
                    }} />
                  </div>
                  <span className="text-xs font-mono" style={{ color: draft.midiEnabled ? "#4ade80" : "rgba(255,255,255,0.4)" }}>
                    MIDI CC ENABLED
                  </span>
                </label>
                {draft.midiEnabled && (
                  <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    {([
                      ["CC NUMBER", "midiCC", 0, 127],
                      ["CHANNEL", "midiCh", 1, 16],
                      ["VALUE MIN", "midiMin", 0, 127],
                      ["VALUE MAX", "midiMax", 0, 127],
                    ] as [string, keyof StompSlot, number, number][]).map(([lbl, key, mn, mx]) => (
                      <div key={key} className="flex flex-col gap-1">
                        <span className="text-xs font-mono opacity-40">{lbl}</span>
                        <input
                          type="number" min={mn} max={mx}
                          value={(draft[key] as number) ?? (key === 'midiCh' ? 1 : key === 'midiMax' ? 127 : 0)}
                          onChange={e => setDraft({ ...draft, [key]: Math.max(mn, Math.min(mx, Number(e.target.value))) })}
                          className="px-2 py-1 text-sm font-mono rounded w-full"
                          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.18)", color: "white" }}
                        />
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs font-mono opacity-25 leading-relaxed">
                  MIDI CC will be sent when this stomp is toggled via Command Center instant commands.
                </p>
              </div>
            )}

            {/* LABEL tab */}
            {pickerTab === 'label' && (
              <div className="flex flex-col gap-3 p-4">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-mono opacity-40">DISPLAY LABEL (MAX 10)</span>
                  <input
                    value={draft.label}
                    onChange={e => setDraft({ ...draft, label: e.target.value.slice(0, 10) })}
                    placeholder="e.g. DRIVE"
                    className="px-2 py-1 text-sm font-mono rounded"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.18)", color: "white" }}
                    autoFocus
                    onKeyDown={e => { if (e.key === "Enter") applyPicker(); if (e.key === "Escape") setPickerSlot(null); }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-mono opacity-40">LED COLOR</span>
                  <div className="flex flex-wrap gap-2">
                    {HELIX_COLORS.map(c => (
                      <button key={c.id} onClick={() => setDraft({ ...draft, color: c.id })} title={c.name}
                        className="rounded-full transition-transform"
                        style={{
                          width: 22, height: 22, background: c.hex,
                          outline: draft.color === c.id ? "2px solid white" : "none",
                          outlineOffset: 2,
                          transform: draft.color === c.id ? "scale(1.25)" : "scale(1)",
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Picker footer */}
            <div className="flex items-center gap-2 px-3 py-2 border-t" style={{ borderColor: "#1a1a28" }}>
              {draft.model && (
                <span className="text-xs font-mono opacity-40 flex-1 truncate">{draft.model}</span>
              )}
              <button onClick={applyPicker}
                className="px-4 py-1.5 text-xs font-mono rounded font-bold ml-auto"
                style={{ background: "#ff6b1a", color: "#000" }}
              >APPLY</button>
              <button onClick={() => setPickerSlot(null)}
                className="px-3 py-1.5 text-xs font-mono rounded opacity-40"
                style={{ border: "1px solid rgba(255,255,255,0.2)" }}
              >CANCEL</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function StompButton({ slot, block, onEdit }: { slot: StompSlot; block?: BlockInfo; onEdit: (n: number) => void }) {
  const helixColor = HELIX_COLORS.find(c => c.id === slot.color) ?? HELIX_COLORS[0];
  const modelInfo = slot.model ? ALL_MODELS.find(m => m.id === slot.model) : null;
  const labelTrimmed = slot.label.trim();
  const hasContent = labelTrimmed.length > 0 || !!slot.model;

  // Derive display from manually-assigned model > auto block > empty
  const blockCat = block ? (() => {
    switch (block.type) {
      case "amp": case "pre": return { border: "#e03030", bg: "#200808", abbr: "AMP" };
      case "cab": return { border: "#b04820", bg: "#180c05", abbr: "CAB" };
      case "dist": return { border: "#c06010", bg: "#180e03", abbr: "DIST" };
      case "delay": return { border: "#20c070", bg: "#061a0e", abbr: "DLY" };
      case "reverb": return { border: "#20a0c0", bg: "#061318", abbr: "REV" };
      default: return getBlockCat(block.name);
    }
  })() : null;
  const blockModelInfo = block ? ALL_MODELS.find(m => m.id === block.model || m.id === block.model.replace(/Stereo$/,"Mono") || m.id === block.model.replace(/Mono$/,"Stereo")) : null;

  const accentColor = modelInfo?.border ?? blockCat?.border ?? (hasContent ? helixColor.hex : null);
  const ledColor = accentColor ?? "#16162a";
  const borderColor = accentColor ? accentColor + "66" : "#1e1e2e";
  const displayName = labelTrimmed || modelInfo?.name || block?.name || "";

  return (
    <button
      onClick={() => onEdit(slot.slot)}
      className="rounded transition-all"
      style={{
        display: "flex", flexDirection: "column", alignItems: "stretch",
        background: "linear-gradient(180deg, #16161f 0%, #0e0e16 100%)",
        border: `1px solid ${borderColor}`,
        boxShadow: (hasContent || block)
          ? `0 0 14px ${ledColor}18, inset 0 1px 0 rgba(255,255,255,0.04)`
          : "inset 0 1px 0 rgba(255,255,255,0.02)",
        cursor: "pointer",
        minWidth: 0,
      }}
      title={block ? `${block.name} — stomp ${slot.slot}` : `Stomp ${slot.slot} — click to assign`}
    >
      {/* Body: icon + LED stacked */}
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 5, padding: "10px 6px 8px", flex: 1,
      }}>
        {/* Icon: manual model > auto block icon > knob */}
        {modelInfo ? (
          <div style={{
            width: 34, height: 34, borderRadius: 7,
            background: modelInfo.img ? "transparent" : modelInfo.bg,
            border: `1.5px solid ${modelInfo.border}`,
            boxShadow: `0 0 8px ${modelInfo.border}44`,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, overflow: "hidden",
          }}>
            {modelInfo.img
              ? <img src={`/helix-icons/${modelInfo.img}`} alt={modelInfo.name} style={{ width: 30, height: 30, objectFit: "contain" }} />
              : <span style={{ fontSize: 8, fontFamily: "monospace", fontWeight: "bold", color: modelInfo.border, letterSpacing: "0.05em" }}>{modelInfo.abbr}</span>
            }
          </div>
        ) : block && blockCat ? (
          <div style={{
            width: 34, height: 34, borderRadius: 7,
            background: blockModelInfo?.img ? "transparent" : blockCat.bg,
            border: `1.5px solid ${blockCat.border}`,
            boxShadow: `0 0 8px ${blockCat.border}55`,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, overflow: "hidden",
          }}>
            {blockModelInfo?.img
              ? <img src={`/helix-icons/${blockModelInfo.img}`} alt={block.name} style={{ width: 30, height: 30, objectFit: "contain" }} />
              : <span style={{ fontSize: 8, fontFamily: "monospace", fontWeight: "bold", color: blockCat.border, letterSpacing: "0.05em" }}>{blockCat.abbr}</span>
            }
          </div>
        ) : (
          <div style={{
            width: 30, height: 30, borderRadius: "50%",
            background: "radial-gradient(circle at 38% 32%, #2e2e46, #181824)",
            border: "2px solid #26263a",
            boxShadow: "0 3px 7px rgba(0,0,0,0.7)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            paddingTop: 5, flexShrink: 0,
          }}>
            <div style={{ width: 2, height: 9, background: "#58587a", borderRadius: 1 }} />
          </div>
        )}
        {/* LED */}
        <div style={{
          width: 7, height: 7, borderRadius: "50%",
          background: (hasContent || block) ? ledColor : "#16162a",
          boxShadow: (hasContent || block) ? `0 0 7px 2px ${ledColor}66` : "none",
          transition: "all 0.2s", flexShrink: 0,
        }} />
      </div>

      {/* Label strip — always visible at the bottom */}
      <div style={{
        background: (hasContent || block) ? ledColor + "22" : "rgba(0,0,0,0.3)",
        borderTop: `1px solid ${(hasContent || block) ? ledColor + "55" : "rgba(255,255,255,0.08)"}`,
        padding: "6px 6px 6px",
        minHeight: 38,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 11, fontFamily: "monospace", fontWeight: 700,
          color: displayName ? "#ffffff" : "rgba(255,255,255,0.3)",
          textAlign: "center", lineHeight: 1.3,
          whiteSpace: "normal", wordBreak: "break-word",
        }}>
          {block?.name || displayName || `FS${slot.slot}`}
        </span>
        {slot.midiEnabled && (
          <span style={{ fontSize: 7, fontFamily: "monospace", color: "#4ade80", opacity: 0.8, letterSpacing: "0.04em" }}>
            CC{slot.midiCC ?? "?"}
          </span>
        )}
      </div>
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
    <div className="flex flex-col rounded-xl" style={{ border: "1px solid #2a2010", background: "#0d0d10" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b" style={{ borderColor: "#1a1808" }}>
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
            className="flex flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-all"
            style={{
              borderBottom: si < 3 ? "1px solid #141408" : undefined,
              borderRight: si % 3 !== 2 ? "1px solid #141408" : undefined,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(251,191,36,0.04)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
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
        <div className="flex flex-col gap-3 px-4 py-3 border-t" style={{ borderColor: "#1a1808", background: "#0a0a0d" }}>
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
  const [readingBuffer, setReadingBuffer] = useState(false);
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
  const [presetSignalChainB, setPresetSignalChainB] = useState<Array<{slotIdx: number; block: unknown}>>([]);
  const [presetStomps, setPresetStomps] = useState<Array<{slot: number; label: string; color: number}>>([]);
  const [stompDebug, setStompDebug] = useState<{ topKeys: string[]; stompCount: number; sampleSource?: Record<string, unknown> | null } | null>(null);
  const [modelNames, setModelNames] = useState<Record<number, string>>({});
  const [modelCatalogIds, setModelCatalogIds] = useState<Record<number, string>>({});
  // HSP flow[1] topology — used to supplement DSP 2 display (sfg_ omits amps in DSP 2)
  const [hspDsp2, setHspDsp2] = useState<Array<{slot: number; model: string; name: string; type: string; path: number}> | null>(null);
  // Stomp→block mapping derived from HSP auto-assignment
  const [stompMap, setStompMap] = useState<{ bankA: Array<{slot:number;model:string;name:string;type:string}>; bankB: Array<{slot:number;model:string;name:string;type:string}> } | null>(null);
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
          let name = browserPresetsRef.current.find((x) => x.cid === cid)?.name;
          if (!name) {
            // Browser list not loaded yet — silently fetch factory presets to resolve name
            try {
              const r = await fetch(`/api/stadium/contents?ip=${encodeURIComponent(ip)}&cid=-1`);
              const j = await r.json() as { ok: boolean; presets?: PresetEntry[] };
              if (j.ok && j.presets) {
                browserPresetsRef.current = j.presets;
                name = j.presets.find(x => x.cid === cid)?.name;
              }
            } catch { /* best-effort */ }
          }
          setDevicePresetName(name ?? "");
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

  const readEditBuffer = useCallback(async () => {
    setReadingBuffer(true);
    try {
      const res = await fetch(`/api/stadium/editbuffer?ip=${encodeURIComponent(ip)}`);
      const j = await res.json() as { ok: boolean; presetCid?: number; rawBlob?: string; stomps?: Array<{slot:number;label:string;color:number}>; stompDebug?: { topKeys: string[]; stompCount: number; sampleSource?: Record<string, unknown> | null }; data?: unknown; error?: string };
      if (!j.ok) return;
      if (j.rawBlob) setEditBlobB64(j.rawBlob);
      const d = j.data as Record<string, unknown>;
      // Snapshots
      try {
        const entt = (d?.['cg__'] as Record<string,unknown>)?.['entt'] as Record<string,unknown>;
        const snpsRaw = entt?.['snps'] as unknown[] | undefined;
        if (Array.isArray(snpsRaw) && snpsRaw.length > 0) {
          const snaps = snpsRaw.filter(s => s && typeof s === 'object').map(s => {
            const so = s as Record<string,unknown>;
            return { name: String(so['name'] ?? ''), si__: Number(so['si__'] ?? 0), colr: Number(so['colr'] ?? 0) };
          }).sort((a,b) => a.si__ - b.si__);
          setPresetSnaps(snaps);
        }
      } catch { /* optional */ }
      // Signal chain — both paths
      try {
        const flowArr = (d?.['sfg_'] as Record<string,unknown>)?.['flow'] as unknown[] | undefined;
        const parseFlow = (pathObj: unknown) => {
          const blks = (pathObj as Record<string,unknown>)?.['blks'] as unknown[] | undefined;
          if (!Array.isArray(blks)) return [];
          const pairs: Array<{slotIdx:number;block:unknown}> = [];
          for (let bi = 0; bi+1 < blks.length; bi+=2) pairs.push({ slotIdx: Number(blks[bi]), block: blks[bi+1] });
          return pairs;
        };
        if (Array.isArray(flowArr) && flowArr.length > 0) {
          const pathA = parseFlow(flowArr[0]);
          const pathB = flowArr.length > 1 ? parseFlow(flowArr[1]) : [];
          setPresetSignalChain(pathA);
          setPresetSignalChainB(pathB);
          // Build slot payload for name resolution.
          // flow[1] (DSP 2) slots are offset by 1000 so they don't collide with
          // HSP slot correlation (which only covers flow[0] slots 0-27). This forces
          // DSP 2 blocks to fall back to the numeric ID map, avoiding wrong names.
          const DSP2_OFFSET = 1000;
          const slotPayload = [
            ...pathA.flatMap(({ slotIdx, block }) => {
              const b = block as Record<string,unknown>;
              const mdls = b?.['mdls'] as Array<Record<string,unknown>> | undefined;
              const modelId = Array.isArray(mdls) && mdls.length > 0 ? mdls[0]['id__'] as number : null;
              return modelId != null ? [{ slot: slotIdx, modelId }] : [];
            }),
            ...pathB.flatMap(({ slotIdx, block }) => {
              const b = block as Record<string,unknown>;
              const mdls = b?.['mdls'] as Array<Record<string,unknown>> | undefined;
              const modelId = Array.isArray(mdls) && mdls.length > 0 ? mdls[0]['id__'] as number : null;
              return modelId != null ? [{ slot: slotIdx + DSP2_OFFSET, modelId }] : [];
            }),
          ];
          if (slotPayload.length > 0) {
            fetch("/api/stadium/resolve-models", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ presetName: devicePresetName, slots: slotPayload }),
            }).then(r => r.json()).then((nm: { ok: boolean; names?: Record<number,string>; catalogIds?: Record<number,string>; hspDsp2?: Array<{slot:number;model:string;name:string;type:string;path:number}> | null; stompMap?: { bankA: Array<{slot:number;model:string;name:string;type:string}>; bankB: Array<{slot:number;model:string;name:string;type:string}> } | null }) => {
              if (nm.ok && nm.names) setModelNames(nm.names);
              if (nm.ok && nm.catalogIds) setModelCatalogIds(nm.catalogIds);
              if (nm.ok) setHspDsp2(nm.hspDsp2 ?? null);
              if (nm.ok) setStompMap(nm.stompMap ?? null);
            }).catch(() => {});
          }
        }
      } catch { /* optional */ }
      // Stomps — use server-extracted data (source IDs + pm__ fallback)
      if (j.stompDebug) setStompDebug(j.stompDebug);
      if (Array.isArray(j.stomps)) {
        setPresetStomps(j.stomps);
      }
    } catch { /* ignore */ } finally {
      setReadingBuffer(false);
    }
  }, [ip, devicePresetName]);

  const loadFromBrowser = useCallback(async (entry: PresetEntry) => {
    setActiveCid(entry.cid);
    setDeviceCid(entry.cid);
    setDevicePresetName(entry.name);
    setCidInput(String(entry.cid));
    setPresetSignalChain([]);
    setPresetSignalChainB([]);
    setHspDsp2(null);
    setStompMap(null);
    setPresetStomps([]);
    setStompDebug(null);
    setModelNames({});
    setModelCatalogIds({});
    await loadPresetByCid(entry.cid, parseInt(reqIdInput, 10));
    await new Promise(r => setTimeout(r, 600));
    await readEditBuffer();
  }, [loadPresetByCid, readEditBuffer, reqIdInput]);

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
        diag?: { typeTags: string; args: string[] };
      };
      if (!j.ok) {
        setBrowserError(j.error ?? "request failed");
        return;
      }
      const presets = j.presets ?? [];
      setBrowserPresets(presets);
      if (overrideCid === undefined) browserPresetsRef.current = presets;
      if (j.raw) setBrowserRaw(JSON.stringify(j.raw, null, 2).slice(0, 4000));
      if (j.diag) setBrowserRaw(prev => (prev ? prev : "") + "\n\n[OSC] " + JSON.stringify(j.diag));

      if (presets.length === 0 && (j.count === 0 || j.count == null)) {
        // "user" tab: user presets live in setlists on the Stadium, not a flat container.
        // Auto-fall-back to setlists so the user can navigate to their presets.
        if (tab === "user" && overrideCid === undefined) {
          setBrowserLoading(false);
          setBrowserError("");
          setBrowserTab("setlists");
          setBrowserCidStack([]);
          // Tail-call to setlists fetch — let the new tab's fetch run
          const resSL = await fetch(`/api/stadium/contents?ip=${encodeURIComponent(ip)}&cid=${CONTAINER_SETLISTS}`);
          const jSL = await resSL.json() as { ok: boolean; presets?: PresetEntry[]; count?: number; error?: string; raw?: unknown; diag?: unknown };
          if (!jSL.ok) { setBrowserError(jSL.error ?? "setlists request failed"); return; }
          const slPresets = jSL.presets ?? [];
          setBrowserPresets(slPresets);
          if (jSL.raw) setBrowserRaw(JSON.stringify(jSL.raw, null, 2).slice(0, 4000));
          if (slPresets.length === 0) setBrowserError("no setlists found — is the device connected and in edit mode?");
          return;
        }
        setBrowserError("empty container — no presets found");
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
        background: "#08080f",
        color: "#c8c8e0",
        fontFamily: "var(--font-mono, monospace)",
      }}
    >
      {/* header */}
      <header
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: "#14141f", background: "#0a0a12" }}
      >
        <h1
          className="text-sm font-mono tracking-widest"
          style={{ color: "#ff6b1a" }}
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
          className="flex flex-wrap items-center gap-3 px-4 py-2 rounded-xl"
          style={{ background: "#0d0d16", border: "1px solid #1a1a28" }}
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
                      ? { background: "rgba(255,107,26,0.25)", border: "1px solid #ff6b1a", color: "#ff6b1a", boxShadow: "0 0 10px rgba(255,107,26,0.3)" }
                      : { background: "#111120", border: "1px solid #1e1e30", color: "rgba(255,255,255,0.4)" })
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

        {/* signal chain viewer — always visible when connected */}
        {status === "live" && (() => {
          const LINE_COLOR = "#1e1e30";
          const LINE_W = 32;
          const BLK = 140; // block size

          const renderBlock = (slotIdx: number, block: unknown, key: string | number) => {
            if (!block || typeof block !== "object") return null;
            const b = block as Record<string, unknown>;
            const mdls = b["mdls"] as Array<Record<string, unknown>> | undefined;
            const modelId = Array.isArray(mdls) && mdls.length > 0 ? (mdls[0]["id__"] as number) : null;
            const isBypassed = b["enbl"] === 0 || b["enbl"] === false;
            const blockType = b["type"];
            const resolvedName = modelId != null ? modelNames[modelId] : undefined;
            const label = resolvedName ?? (modelId != null ? `mid:${modelId}` : blockType === 8 ? "INPUT" : blockType === 4 ? "OUTPUT" : `blk${slotIdx}`);
            const cat = getBlockCat(label);
            const catalogId = modelId != null ? modelCatalogIds[modelId] : undefined;
            const defEntry = catalogId ? MODEL_DEFS[catalogId] : undefined;
            const imgFile = defEntry?.img ?? null;
            const borderCol = isBypassed ? "#252535" : cat.border;
            return (
              <div key={key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <div style={{
                  width: BLK, height: BLK, borderRadius: 22,
                  background: "#000",
                  border: `2px solid ${borderCol}`,
                  boxShadow: isBypassed ? "none" : `0 0 28px ${cat.border}40, inset 0 0 36px ${cat.border}0c`,
                  opacity: isBypassed ? 0.35 : 1,
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 4,
                  flexShrink: 0, overflow: "hidden", position: "relative",
                }}>
                  {imgFile
                    ? <img src={`/helix-icons/${imgFile}`} alt={label} style={{ width: 116, height: 116, objectFit: "contain" }} />
                    : <span style={{ fontSize: 18, fontFamily: "monospace", fontWeight: "bold", color: borderCol, letterSpacing: "0.08em" }}>{cat.abbr}</span>
                  }
                </div>
                <span style={{
                  fontSize: 11, fontFamily: "monospace", color: isBypassed ? "#2e2e42" : "rgba(255,255,255,0.85)",
                  textAlign: "center", lineHeight: 1.3, maxWidth: BLK, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600,
                }}>
                  {resolvedName ?? (modelId != null ? `#${modelId}` : label)}
                </span>
              </div>
            );
          };

          // Empty slot placeholder for unoccupied grid positions
          const renderEmptySlot = () => (
            <div style={{
              width: BLK, height: BLK, borderRadius: 22,
              border: "1px dashed rgba(255,255,255,0.05)",
              flexShrink: 0,
            }} />
          );

          // Render a path at fixed slot positions (always 14 slots).
          // slotOffset: 0 for top arm (slots 0-13), 14 for bottom arm (slots 14-27 → displayed as 0-13).
          const renderPathRow = (chain: typeof presetSignalChain, slotOffset = 0) => {
            const MAX = 14;
            const slotMap = new Map(chain.map(e => [e.slotIdx - slotOffset, e]));
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                {Array.from({ length: MAX }, (_, si) => {
                  const e = slotMap.get(si);
                  return (
                    <div key={si} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                      {e ? renderBlock(e.slotIdx, e.block, si) : renderEmptySlot()}
                      {si < MAX - 1 && <div style={{ width: LINE_W, height: 2, background: LINE_COLOR, flexShrink: 0 }} />}
                    </div>
                  );
                })}
              </div>
            );
          };

          // ── 4-row signal chain layout ─────────────────────────────────────
          // Each DSP (flow) has 2 arms: slots 0-13 (top arm) and 14-27 (bottom parallel arm).
          // flow[0] = DSP 1 (rows 1+2), flow[1] = DSP 2 (rows 3+4).
          // The bottom arm exists only when a Split block is used within that DSP.

          const isRealBlock = (block: unknown): boolean => {
            const b = block as Record<string, unknown>;
            const mdls = b["mdls"] as Array<Record<string, unknown>> | undefined;
            if (!Array.isArray(mdls) || mdls.length === 0) return false;
            const id = mdls[0]["id__"];
            if (typeof id !== "number" || id === 0) return false;
            const resolved = modelNames[id];
            if (resolved !== undefined && /^(none|no\s*cab)$/i.test(resolved)) return false;
            return true;
          };

          // DSP 1 (flow[0]): top arm = slots 0-13, bottom arm = slots 14-27
          const pathAReal      = presetSignalChain.filter(({ slotIdx }) => slotIdx < 14);
          const path1BFiltered = presetSignalChain.filter(({ slotIdx, block }) => slotIdx >= 14 && isRealBlock(block));

          // DSP 2 (flow[1]): sfg_ fallback (used when no HSP available)
          const path2AFiltered = presetSignalChainB.filter(({ slotIdx, block }) => slotIdx < 14 && isRealBlock(block));
          const path2BFiltered = presetSignalChainB.filter(({ slotIdx, block }) => slotIdx >= 14 && isRealBlock(block));

          // HSP topology for DSP 2 — more accurate than sfg_ (sfg_ omits amp blocks in DSP 2).
          // Skip "InputNone" routing connector; keep split, amps, cabs, join, fx, output.
          type HspBlk = { slot: number; model: string; name: string; type: string; path: number };
          const hspTop: HspBlk[] | null = hspDsp2
            ? hspDsp2.filter(b => b.path === 0 && !b.model.startsWith("P35_Input")).sort((a, b) => a.slot - b.slot)
            : null;
          const hspBot: HspBlk[] | null = hspDsp2
            ? hspDsp2.filter(b => b.path === 1).sort((a, b) => a.slot - b.slot)
            : null;

          const hasDSP1Split = path1BFiltered.length > 0;
          const hasDSP2      = hspDsp2
            ? (hspTop && hspTop.length > 0) || (hspBot && hspBot.length > 0)
            : path2AFiltered.length > 0 || path2BFiltered.length > 0;
          const hasDSP2Split = hspDsp2
            ? !!(hspBot && hspBot.length > 0)
            : path2BFiltered.length > 0;

          const UNIT = BLK + LINE_W;
          const BRIDGE_H = 44;

          const blockMatchesLabel = (block: unknown, re: RegExp) => {
            const b = block as Record<string, unknown>;
            const mdls = b["mdls"] as Array<Record<string, unknown>> | undefined;
            const modelId = Array.isArray(mdls) && mdls.length > 0 ? (mdls[0]["id__"] as number) : null;
            if (modelId == null) return false;
            return re.test(modelNames[modelId] ?? "") || re.test(modelCatalogIds[modelId] ?? "");
          };

          // Map HSP block type → category (guarantees correct colors for amps/cabs
          // even when the model name string doesn't match getBlockCat patterns)
          const hspTypeToCat = (type: string) => {
            switch (type) {
              case "amp": case "pre": return { border: "#e03030", bg: "#200808", abbr: "AMP" };
              case "cab": return { border: "#b04820", bg: "#180c05", abbr: "CAB" };
              case "dist": return { border: "#c06010", bg: "#180e03", abbr: "DIST" };
              case "delay": return { border: "#20c070", bg: "#061a0e", abbr: "DLY" };
              case "reverb": return { border: "#20a0c0", bg: "#061318", abbr: "REV" };
              case "split": return { border: "#4a4a6a", bg: "#0e0e1a", abbr: "SPL" };
              case "join": return { border: "#4a4a6a", bg: "#0e0e1a", abbr: "MRG" };
              case "input": return { border: "#4a4a6a", bg: "#0e0e1a", abbr: "IN" };
              case "output": return { border: "#4a4a6a", bg: "#0e0e1a", abbr: "OUT" };
              default: return null;
            }
          };

          // Renderer for HSP-sourced blocks (uses model string directly, not numeric ID)
          const renderHspBlock = (hb: HspBlk, key: number | string) => {
            const name = modelDisplayName(hb.model) || hb.name;
            const cat  = hspTypeToCat(hb.type) ?? getBlockCat(name);
            const def  = lookupDef(hb.model);
            const img  = def?.img ?? null;
            return (
              <div key={key} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, flexShrink:0 }}>
                <div style={{
                  width:BLK, height:BLK, borderRadius:22, background:"#000",
                  border:`2px solid ${cat.border}`,
                  boxShadow:`0 0 28px ${cat.border}40, inset 0 0 36px ${cat.border}0c`,
                  display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                  gap:4, flexShrink:0, overflow:"hidden",
                }}>
                  {img
                    ? <img src={`/helix-icons/${img}`} alt={name} style={{ width:116, height:116, objectFit:"contain" }} />
                    : <span style={{ fontSize:18, fontFamily:"monospace", fontWeight:"bold", color:cat.border, letterSpacing:"0.08em" }}>{cat.abbr}</span>
                  }
                </div>
                <span style={{
                  fontSize:11, fontFamily:"monospace", color:"rgba(255,255,255,0.85)",
                  textAlign:"center", lineHeight:1.3, maxWidth:BLK,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontWeight:600,
                }}>{name}</span>
              </div>
            );
          };

          // Render an HSP-sourced row at fixed slot positions.
          // slotOffset: 0 for path=0 (slots 0-13), 14 for path=1 (slots 14-27 → displayed as 0-13).
          const renderHspRow = (blocks: HspBlk[], slotOffset = 0) => {
            const MAX = 14;
            const slotMap = new Map(blocks.map(b => [b.slot - slotOffset, b]));
            return (
              <div style={{ display:"flex", alignItems:"center", gap:0 }}>
                {Array.from({ length: MAX }, (_, si) => {
                  const hb = slotMap.get(si);
                  return (
                    <div key={si} style={{ display:"flex", alignItems:"center", flexShrink:0 }}>
                      {hb ? renderHspBlock(hb, si) : renderEmptySlot()}
                      {si < MAX - 1 && <div style={{ width:LINE_W, height:2, background:LINE_COLOR, flexShrink:0 }} />}
                    </div>
                  );
                })}
              </div>
            );
          };

          // Find split/join SLOT NUMBERS in each DSP's top arm (for bridge x-position).
          // Using slot numbers (not array indices) so bridge aligns with the fixed grid.
          const dsp1SplitSlot = pathAReal.find(({ block }) => blockMatchesLabel(block, /split/i))?.slotIdx ?? -1;
          const dsp1JoinSlot  = pathAReal.find(({ block }) => blockMatchesLabel(block, /\bjoin\b|merge/i))?.slotIdx ?? -1;
          const dsp2SplitSlot = hspTop
            ? (hspTop.find(b => /split/i.test(b.name) || /AppDSPSplit/.test(b.model))?.slot ?? -1)
            : (path2AFiltered.find(({ block }) => blockMatchesLabel(block, /split/i))?.slotIdx ?? -1);
          const dsp2JoinSlot  = hspTop
            ? (hspTop.find(b => /\bjoin\b|merge/i.test(b.name) || /AppDSPJoin|AppDSPMixer/.test(b.model))?.slot ?? -1)
            : (path2AFiltered.find(({ block }) => blockMatchesLabel(block, /\bjoin\b|merge/i))?.slotIdx ?? -1);

          const renderBridge = (splitSlot: number, joinSlot: number) => {
            const splitCX = splitSlot * UNIT + BLK / 2 - 1;
            const joinCX  = joinSlot >= 0 ? joinSlot * UNIT + BLK / 2 - 1 : -1;
            return (
              <div style={{ position: "relative", height: BRIDGE_H, flexShrink: 0 }}>
                <div style={{ position: "absolute", left: splitCX, top: 0, width: 2, height: BRIDGE_H, background: LINE_COLOR }} />
                {joinCX >= 0 && (
                  <div style={{ position: "absolute", left: joinCX, top: 0, width: 2, height: BRIDGE_H, background: LINE_COLOR }} />
                )}
              </div>
            );
          };

          const dsp2TopLen = hspTop ? hspTop.length : path2AFiltered.length;
          const dsp2BotLen = hspBot ? hspBot.length : path2BFiltered.length;
          const totalBlocks = pathAReal.length + path1BFiltered.length + dsp2TopLen + dsp2BotLen;

          return (
            <div className="flex flex-col rounded-xl overflow-hidden" style={{ background: "#000", border: "1px solid #1a1a28" }}>
              {/* header */}
              <div className="flex items-center gap-3 px-4 py-2 border-b" style={{ borderColor: "#111120" }}>
                <span className="text-xs font-mono tracking-widest" style={{ color: "#3a3a58" }}>SIGNAL CHAIN</span>
                {totalBlocks > 0 && (
                  <span className="text-xs font-mono" style={{ color: "#252538" }}>
                    {totalBlocks} blocks{hasDSP2 ? " · 2 DSP" : ""}
                  </span>
                )}
                <button
                  onClick={readEditBuffer}
                  disabled={readingBuffer}
                  className="px-4 py-1 text-xs font-mono font-bold rounded tracking-widest transition-all"
                  style={{
                    background: readingBuffer ? "rgba(255,107,26,0.1)" : "rgba(255,107,26,0.22)",
                    border: "1px solid rgba(255,107,26,0.6)",
                    color: "#ff6b1a",
                    opacity: readingBuffer ? 0.6 : 1,
                  }}
                >
                  {readingBuffer ? "READING…" : "⟳ READ DEVICE"}
                </button>
                {presetSignalChain.length > 0 && (
                  <button
                    onClick={() => { setPresetSignalChain([]); setPresetSignalChainB([]); setHspDsp2(null); setModelNames({}); setModelCatalogIds({}); }}
                    className="ml-auto text-xs font-mono hover:opacity-100 transition-opacity"
                    style={{ color: "#2e2e48", opacity: 0.5 }}
                  >CLEAR</button>
                )}
              </div>

              {/* paths */}
              <div className="overflow-x-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "#1e1e30 transparent" }}>
                <div style={{ position: "relative", display: "inline-flex", flexDirection: "column", gap: 0, padding: "20px 24px", minWidth: "max-content" }}>

                  {/* ── DSP 1 Row 1: flow[0] slots 0-13 (fixed 14-slot grid) ── */}
                  {pathAReal.length > 0 && renderPathRow(pathAReal)}

                  {/* ── DSP 1 Row 2: parallel bottom arm slots 14-27 ──────── */}
                  {hasDSP1Split && dsp1SplitSlot >= 0 && renderBridge(dsp1SplitSlot, dsp1JoinSlot)}
                  {hasDSP1Split && renderPathRow(path1BFiltered, 14)}

                  {/* ── Separator between DSP 1 and DSP 2 ─────────────────── */}
                  {pathAReal.length > 0 && hasDSP2 && (
                    <div style={{ height: 1, background: "#1a1a28", margin: "16px 0", flexShrink: 0 }} />
                  )}

                  {/* ── DSP 2 Row 3: HSP topology (preferred) or sfg_ fallback ── */}
                  {hasDSP2 && (hspTop && hspTop.length > 0
                    ? renderHspRow(hspTop)
                    : path2AFiltered.length > 0 && renderPathRow(path2AFiltered)
                  )}

                  {/* ── DSP 2 Row 4: parallel bottom arm slots 14-27 ──────── */}
                  {hasDSP2Split && dsp2SplitSlot >= 0 && renderBridge(dsp2SplitSlot, dsp2JoinSlot)}
                  {hasDSP2Split && (hspBot && hspBot.length > 0
                    ? renderHspRow(hspBot, 14)
                    : renderPathRow(path2BFiltered, 14)
                  )}

                </div>
              </div>
            </div>
          );
        })()}

        {/* stomp debug — only when extraction finds nothing */}
        {stompDebug && stompDebug.stompCount === 0 && (
          <div className="px-3 py-2 rounded text-xs font-mono break-all" style={{ background: "#0e0e1a", border: "1px solid #2a1a1a", color: "#ff6b1a" }}>
            STOMP DEBUG — 0 sources found · blob keys: {stompDebug.topKeys.join(" · ")}
            {stompDebug.sampleSource && <span> · sample: {JSON.stringify(stompDebug.sampleSource)}</span>}
          </div>
        )}

        {/* visual pedalboard — show whenever a preset has been read */}
        {presetSignalChain.length > 0 && (
          <Pedalboard
            stomps={presetStomps}
            ip={ip}
            devicePresetName={devicePresetName}
            stompMap={stompMap}
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
          className="flex flex-col rounded-xl"
          style={{ border: "1px solid #221810", background: "#0d0b0a" }}
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
                        onClick={() => browserTab === "setlists" && browserCidStack.length < 1 ? drillIntoBrowserEntry(p) : loadFromBrowser(p)}
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
                          {browserTab === "setlists" && browserCidStack.length < 1 ? (
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
                    // Extract signal chain from sfg_.flow[0..1].blks (alternating [slot_idx, blockObj, ...])
                    try {
                      const d = j.data as Record<string, unknown>;
                      const flowArr = (d?.['sfg_'] as Record<string, unknown>)?.['flow'] as unknown[] | undefined;
                      const parseFlow = (pathObj: unknown): Array<{slotIdx: number; block: unknown}> => {
                        const blks = (pathObj as Record<string, unknown>)?.['blks'] as unknown[] | undefined;
                        if (!Array.isArray(blks)) return [];
                        const pairs: Array<{slotIdx: number; block: unknown}> = [];
                        for (let bi = 0; bi + 1 < blks.length; bi += 2)
                          pairs.push({ slotIdx: Number(blks[bi]), block: blks[bi + 1] });
                        return pairs;
                      };
                      if (Array.isArray(flowArr) && flowArr.length > 0) {
                        const pathA = parseFlow(flowArr[0]);
                        const pathB = flowArr.length > 1 ? parseFlow(flowArr[1]) : [];
                        setPresetSignalChain(pathA);
                        setPresetSignalChainB(pathB);
                        // Resolve model names from .hsp file correlation
                        const allPairs = [...pathA, ...pathB];
                        const slotPayload = allPairs.flatMap(({ slotIdx, block }) => {
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
                          }).then(r => r.json()).then((nm: { ok: boolean; names?: Record<number, string>; catalogIds?: Record<number, string> }) => {
                            if (nm.ok && nm.names) setModelNames(nm.names);
                            if (nm.ok && nm.catalogIds) setModelCatalogIds(nm.catalogIds);
                          }).catch(() => { /* non-critical */ });
                        }
                      }
                    } catch { /* ignore */ }
                    // Extract stomp footswitch labels from pm__ (both stomp.a and stomp.b)
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
                          const m = key.match(/^preset\.floorboard\.stomp\.(a|b)\.(\d+)\.(label|color)$/);
                          if (m) {
                            const bankOffset = m[1] === 'b' ? 12 : 0;
                            const s = parseInt(m[2], 10) + bankOffset;
                            const cur = slotMap.get(s) ?? { label: '', color: 0 };
                            if (m[3] === 'label') cur.label = String(val ?? '');
                            if (m[3] === 'color') cur.color = Number(val ?? 0);
                            slotMap.set(s, cur);
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
