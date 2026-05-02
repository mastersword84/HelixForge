"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { analyzeAudioFile, type AudioAnalysisResult } from "@/lib/audio-analysis";

type ForgeMode = "describe" | "cover" | "upload";
type ForgeStatus = "idle" | "analyzing" | "forging" | "done" | "error";

interface Section {
  name: string;
  snapshotIndex: number;
  approxTimestamp: string;
  toneDescription: string;
  midiCCValue: number;
}

interface MidiInfo {
  cc: number;
  channel: number;
  note: string;
  presetSlot?: string;     // e.g. "1A", "12C"; if set, MIDI starts with PC + CC32
  setlistBank?: string;    // CC32 value as string (1-127)
  projectBpm?: string;     // BPM to encode the MIDI at, matching the user's DAW project tempo
  // Persisted form inputs so a saved song can be reloaded and re-exported
  // with a different preset address for shuffled setlists.
  markersText?: string;
  songOffsetText?: string;
}

interface ForgeMeta {
  name: string;
  description: string;
  chain: string[];
  snapshots: string[];
  sections: Section[] | null;
  midiInfo: MidiInfo | null;
}

interface ForgeResult {
  meta: ForgeMeta;
  hsp: object;
}

/* ── Download .hsp ── */
function downloadHsp(hsp: object, name: string) {
  const blob = new Blob(["rpshnosj" + JSON.stringify(hsp)], {
    type: "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9]/gi, "_")}.hsp`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── MIDI file generator ── */
/**
 * Parse a Helix preset slot like "1A", "12C", "32D" into a Program Change
 * value (0-127). Helix banks have 4 slots each (A/B/C/D), so:
 *   1A → PC 0, 1B → 1, 1C → 2, 1D → 3, 2A → 4, ..., 32D → 127
 */
function parsePresetSlot(slot: string): number | null {
  const m = slot.trim().toUpperCase().match(/^(\d{1,2})([ABCD])$/);
  if (!m) return null;
  const bank = parseInt(m[1], 10);
  const letterIdx = "ABCD".indexOf(m[2]);
  if (bank < 1 || bank > 32) return null;
  const pc = (bank - 1) * 4 + letterIdx;
  if (pc < 0 || pc > 127) return null;
  return pc;
}

function generateMidiFile(
  sections: Section[],
  midiInfo: MidiInfo,
  presetAddress?: { presetSlot: string; setlistBank: string },
  projectBpm = 120
): Uint8Array {
  // Standard TPQN timing matched to the user's project BPM. When MIDI BPM
  // matches Cubase project BPM, events land at the correct absolute seconds
  // regardless of how Cubase handles file tempo events.
  const PPQ = 480;
  const BPM = projectBpm > 0 ? projectBpm : 120;
  const TICKS_PER_SEC = (BPM / 60) * PPQ;

  // "M:SS" or "H:MM:SS" → seconds
  function tsToSeconds(ts: string): number {
    const parts = ts.split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
  }

  // MIDI variable-length quantity encoding
  function vlq(value: number): number[] {
    if (value < 0x80) return [value];
    const out: number[] = [];
    out.unshift(value & 0x7F);
    value >>= 7;
    while (value > 0) {
      out.unshift((value & 0x7F) | 0x80);
      value >>= 7;
    }
    return out;
  }

  const events: number[] = [];
  const ch = Math.max(0, Math.min(15, (midiInfo.channel ?? 1) - 1));

  // Tempo meta event — encodes the BPM into the file. When MIDI BPM matches
  // the project tempo, ticks resolve to the same wall-clock seconds either way.
  const tempoUs = Math.round(60_000_000 / BPM);
  events.push(...vlq(0), 0xFF, 0x51, 0x03,
    (tempoUs >> 16) & 0xFF, (tempoUs >> 8) & 0xFF, tempoUs & 0xFF);

  // Track name meta event
  const trackName = Array.from(new TextEncoder().encode("HelixForge MIDI Map"));
  events.push(...vlq(0), 0xFF, 0x03, ...vlq(trackName.length), ...trackName);

  // ── PRESET RECALL (Option B) ──
  // If the user provided a preset slot address, emit CC32 (bank select) +
  // Program Change at tick 0 so Helix loads the right preset before the
  // song starts.
  if (presetAddress?.presetSlot) {
    const pc = parsePresetSlot(presetAddress.presetSlot);
    const bank = parseInt(presetAddress.setlistBank, 10);
    if (pc !== null && !Number.isNaN(bank) && bank >= 0 && bank <= 127) {
      // CC32 (Bank Select LSB) — selects setlist/group
      events.push(...vlq(0), 0xB0 | ch, 32, bank & 0x7F);
      // Program Change — selects preset within bank
      events.push(...vlq(0), 0xC0 | ch, pc & 0x7F);
    }
  }

  // CC69 events at each section timestamp
  let prevTick = 0;
  for (const s of sections) {
    const tick = Math.round(tsToSeconds(s.approxTimestamp) * TICKS_PER_SEC);
    const delta = Math.max(0, tick - prevTick);
    prevTick = tick;
    events.push(
      ...vlq(delta),
      0xB0 | ch,                   // Control Change on channel
      midiInfo.cc & 0x7F,          // CC number (69)
      s.midiCCValue & 0x7F,        // value (0–7 = snapshot 1–8)
    );
  }

  // End of track
  events.push(...vlq(0), 0xFF, 0x2F, 0x00);

  // Header chunk — standard TPQN division (480 ticks per quarter note)
  const header = [
    0x4D, 0x54, 0x68, 0x64,  // "MThd"
    0x00, 0x00, 0x00, 0x06,  // chunk length = 6
    0x00, 0x00,              // format 0 (single track)
    0x00, 0x01,              // 1 track
    (PPQ >> 8) & 0xFF, PPQ & 0xFF, // 480 PPQ
  ];

  // Track chunk
  const tl = events.length;
  const track = [
    0x4D, 0x54, 0x72, 0x6B,  // "MTrk"
    (tl >> 24) & 0xFF, (tl >> 16) & 0xFF, (tl >> 8) & 0xFF, tl & 0xFF,
    ...events,
  ];

  return new Uint8Array([...header, ...track]);
}

function downloadMidi(
  sections: Section[],
  midiInfo: MidiInfo,
  name: string,
  presetAddress?: { presetSlot: string; setlistBank: string },
  projectBpm?: number
) {
  const bytes = generateMidiFile(sections, midiInfo, presetAddress, projectBpm);
  const blob = new Blob([bytes], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9]/gi, "_")}_midi_map.mid`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Copy to clipboard ── */
function copyText(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

const DESCRIBE_EXAMPLES = [
  "SRV Texas blues - warm edge of breakup, sings on bends",
  "Modern country twang with chicken pickin' snap",
  "Marshall crunch - classic British rock, natural breakup",
  "High gain lead - tight, vocal, infinite sustain",
  "Ambient shimmer swells, dreamy and ethereal",
  "AC/DC thunderous rhythm crunch",
];

/* ── Chain pill ── */
function ChainPill({ label, index, total }: { label: string; index: number; total: number }) {
  const isAmp = /amp|twin|deluxe|princeton|plexi|jcm|jtm|vox|ac\d|mesa|orange|friedman|evh|matchless|dumble|rectif/i.test(label);
  const isCab = /cab|4x12|2x12|1x12|greenback|vintage|alnico|tweed/i.test(label);
  const isIo = index === 0 || index === total - 1;

  let borderColor = "var(--forge-border)";
  let textColor = "var(--forge-muted)";
  let bg = "var(--forge-iron)";

  if (isIo) { borderColor = "var(--forge-faint)"; textColor = "var(--forge-faint)"; bg = "var(--forge-dark)"; }
  if (isAmp) { borderColor = "var(--forge-ember)"; textColor = "var(--forge-ember)"; bg = "rgba(255,107,26,0.12)"; }
  if (isCab) { borderColor = "rgba(255,107,26,0.4)"; textColor = "var(--forge-glow)"; bg = "rgba(255,107,26,0.06)"; }

  return (
    <div className="flex items-center">
      <div
        className="px-3 py-2 rounded text-xs font-mono whitespace-nowrap"
        style={{ border: `1px solid ${borderColor}`, color: textColor, background: bg }}
      >
        {label}
      </div>
      {index < total - 1 && (
        <div className="flex items-center px-1">
          <div className="w-4 h-px" style={{ background: "var(--forge-faint)" }} />
          <div className="w-0 h-0" style={{ borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: `5px solid var(--forge-faint)` }} />
        </div>
      )}
    </div>
  );
}

/* ── Section color by index ── */
function sectionColor(i: number) {
  const colors = [
    "var(--forge-arc)",
    "var(--forge-ember)",
    "var(--forge-hot)",
    "#a78bfa",
    "var(--forge-glow)",
    "#34d399",
    "#f472b6",
    "var(--forge-muted)",
  ];
  return colors[i % colors.length];
}

/* ── Idle placeholder ── */
function IdleState({ mode }: { mode: ForgeMode }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
      <div
        className="w-20 h-20 rounded-2xl flex items-center justify-center mb-6"
        style={{ background: "var(--forge-iron)", border: "1px solid var(--forge-border)" }}
      >
        {mode === "cover" ? (
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--forge-faint)" }}>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        ) : (
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--forge-faint)" }}>
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        )}
      </div>
      <p className="text-base font-mono mb-2" style={{ color: "var(--forge-muted)" }}>
        {mode === "cover" ? "Enter a song and hit Forge" : "Your preset will appear here"}
      </p>
      {mode === "cover" ? (
        <p className="text-sm max-w-xs" style={{ color: "var(--forge-faint)" }}>
          Each song section gets its own snapshot — MIDI CC69 auto-switches them as the track plays
        </p>
      ) : (
        <p className="text-sm" style={{ color: "var(--forge-faint)" }}>Describe your tone and hit Forge Preset</p>
      )}

      {/* Ghost chain */}
      <div className="mt-10 flex flex-wrap items-center gap-0 justify-center opacity-15">
        {["Input", "Drive", "Amp", "Cab", "Reverb", "Output"].map((b, i, arr) => (
          <ChainPill key={b} label={b} index={i} total={arr.length} />
        ))}
      </div>

      {mode === "cover" && (
        <div className="mt-8 flex flex-col gap-1.5 opacity-20">
          {["INTRO", "VERSE", "CHORUS", "BRIDGE", "SOLO", "OUTRO"].map((s, i) => (
            <div key={s} className="flex items-center gap-3 text-xs font-mono" style={{ color: sectionColor(i) }}>
              <span style={{ color: "var(--forge-faint)" }}>CC69 val {i}</span>
              <div className="w-16 h-px" style={{ background: sectionColor(i), opacity: 0.4 }} />
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Analyzing / Forging animation ── */
function ForgingState({ status, mode, analysisResult }: {
  status: ForgeStatus;
  mode: ForgeMode;
  analysisResult: AudioAnalysisResult | null;
}) {
  const isAnalyzing = status === "analyzing";

  const steps = isAnalyzing
    ? ["Decoding audio file", "Computing RMS energy timeline", "Detecting section boundaries", "Measuring frequency bands per section", "Estimating drive levels"]
    : mode === "cover"
    ? ["Mapping sections to song structure", "Calibrating tones from audio data", "Building signal chain", "Generating MIDI automation map", "Writing .hsp file"]
    : ["Analyzing tone description", "Selecting amp + cab", "Building signal chain", "Setting parameters", "Writing .hsp file"];

  const icon = isAnalyzing ? (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--forge-arc)" }}>
      <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
    </svg>
  ) : (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--forge-ember)" }}>
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );

  const accentColor = isAnalyzing ? "var(--forge-arc)" : "var(--forge-ember)";
  const borderColor = isAnalyzing ? "rgba(74,240,255,0.5)" : "var(--forge-ember)";
  const bgColor     = isAnalyzing ? "rgba(74,240,255,0.08)" : "rgba(255,107,26,0.15)";

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
      <div className="relative mb-8">
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center animate-ember"
          style={{ background: bgColor, border: `2px solid ${borderColor}` }}
        >
          {icon}
        </div>
        {[0, 60, 120, 180, 240, 300].map((deg) => (
          <div key={deg} className="absolute w-1.5 h-1.5 rounded-full"
            style={{
              top: "50%", left: "50%",
              background: accentColor,
              transform: `rotate(${deg}deg) translateX(44px) translateY(-50%)`,
              animation: `ember-pulse ${1 + (deg / 300) * 0.5}s ease-in-out infinite`,
            }}
          />
        ))}
      </div>

      <p className="text-lg font-mono font-bold mb-2" style={{ color: "var(--forge-text)" }}>
        {isAnalyzing ? "Analyzing audio..." : mode === "cover" ? "Forging cover preset..." : "Forging your preset..."}
      </p>
      <p className="text-sm mb-8" style={{ color: "var(--forge-muted)" }}>
        {isAnalyzing
          ? "Reading frequency content of each section"
          : mode === "cover" && analysisResult
          ? `Using real measurements from ${analysisResult.sections.length} detected sections`
          : mode === "cover"
          ? "Claude is mapping sections to snapshots"
          : "Claude is building your signal chain"}
      </p>

      {/* Show detected sections if analysis is done and we're now forging */}
      {status === "forging" && analysisResult && (
        <div className="mb-6 w-full max-w-sm">
          <p className="text-xs font-mono mb-2 tracking-widest" style={{ color: "var(--forge-faint)" }}>
            DETECTED SECTIONS
          </p>
          <div className="flex flex-col gap-1.5">
            {analysisResult.sections.map((s, i) => (
              <div key={i} className="flex items-center justify-between text-xs font-mono px-3 py-1.5 rounded"
                style={{ background: "var(--forge-iron)", border: "1px solid var(--forge-border)" }}>
                <span style={{ color: sectionColor(i) }}>{s.startTime}</span>
                <span style={{ color: "var(--forge-muted)" }}>{s.estimatedDrive} · {s.brightness}</span>
                <span style={{ color: "var(--forge-faint)" }}>{s.lowPct}L {s.midPct}M {s.highPct}H</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 w-full max-w-xs">
        {steps.map((step, i) => (
          <div key={step} className="flex items-center gap-3 text-xs font-mono"
            style={{ color: "var(--forge-muted)", animation: `forge-flicker ${2 + i * 0.35}s ease-in-out infinite` }}>
            <div className="w-1.5 h-1.5 rounded-full animate-ember shrink-0" style={{ background: accentColor }} />
            {step}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── MIDI Map table ── */
function MidiMap({ sections, midiInfo }: { sections: Section[]; midiInfo: MidiInfo }) {
  const [copied, setCopied] = useState(false);

  const exportText = sections
    .map((s) => `${s.approxTimestamp.padEnd(8)} CC${midiInfo.cc} ch${midiInfo.channel} val${s.midiCCValue}  →  ${s.name}: ${s.toneDescription}`)
    .join("\n");

  function handleCopy() {
    copyText(exportText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-mono tracking-widest" style={{ color: "var(--forge-faint)" }}>
          MIDI AUTOMATION MAP
        </p>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded transition-all"
          style={{
            border: "1px solid var(--forge-border)",
            color: copied ? "var(--forge-arc)" : "var(--forge-muted)",
            borderColor: copied ? "var(--forge-arc)" : "var(--forge-border)",
          }}
        >
          {copied ? (
            <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>Copied</>
          ) : (
            <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>Copy</>
          )}
        </button>
      </div>

      <div
        className="rounded-lg overflow-hidden"
        style={{ border: "1px solid var(--forge-border)" }}
      >
        {/* Table header */}
        <div
          className="grid text-xs font-mono px-4 py-2.5"
          style={{
            gridTemplateColumns: "70px 90px 60px 1fr",
            background: "var(--forge-iron)",
            color: "var(--forge-faint)",
            borderBottom: "1px solid var(--forge-border)",
            letterSpacing: "0.08em",
          }}
        >
          <span>TIME</span>
          <span>MIDI EVENT</span>
          <span>SNAPSHOT</span>
          <span>TONE</span>
        </div>

        {sections.map((s, i) => (
          <div
            key={i}
            className="grid text-xs px-4 py-3 items-start"
            style={{
              gridTemplateColumns: "70px 90px 60px 1fr",
              background: i % 2 === 0 ? "var(--forge-dark)" : "var(--forge-steel)",
              borderBottom: i < sections.length - 1 ? "1px solid var(--forge-border)" : "none",
            }}
          >
            <span className="font-mono font-bold" style={{ color: sectionColor(i) }}>
              {s.approxTimestamp}
            </span>
            <span className="font-mono" style={{ color: "var(--forge-muted)" }}>
              CC{midiInfo.cc} → {s.midiCCValue}
            </span>
            <span
              className="font-mono font-bold px-2 py-0.5 rounded text-center"
              style={{
                background: `${sectionColor(i)}18`,
                color: sectionColor(i),
                border: `1px solid ${sectionColor(i)}33`,
                fontSize: "10px",
              }}
            >
              {s.name}
            </span>
            <span style={{ color: "var(--forge-muted)" }}>{s.toneDescription}</span>
          </div>
        ))}
      </div>

      <div
        className="mt-3 flex items-start gap-2.5 px-3 py-2.5 rounded text-xs"
        style={{ background: "rgba(74,240,255,0.05)", border: "1px solid rgba(74,240,255,0.15)", color: "var(--forge-arc)" }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 mt-0.5">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>
          MIDI ch {midiInfo.channel} · CC{midiInfo.cc} · {midiInfo.note}
        </span>
      </div>
    </div>
  );
}

/* ── Result ── */
function ResultState({ result, onReset }: { result: ForgeResult; onReset: () => void }) {
  const [showJson, setShowJson] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { meta, hsp } = result;
  const isCover = !!meta.sections;

  async function saveTocatalog() {
    if (saving || saved) return;
    setSaving(true);
    try {
      const [songTitle, artist] = isCover ? meta.name.split(" — ") : [null, null];
      await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: isCover ? "cover" : "describe",
          preset_name: meta.name,
          song_title: songTitle?.trim() || null,
          artist: artist?.trim() || null,
          description: meta.description,
          chain: meta.chain,
          snapshots: meta.snapshots,
          sections: meta.sections,
          midi_info: meta.midiInfo,
          hsp,
        }),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full animate-ember" style={{ background: "var(--forge-ember)" }} />
            <span className="text-xs font-mono tracking-widest" style={{ color: "var(--forge-ember)" }}>
              {isCover ? "COVER PRESET FORGED" : "PRESET FORGED"}
            </span>
          </div>
          <h2
            className="text-xl font-black tracking-tight"
            style={{ fontFamily: "Geist Mono, monospace", color: "var(--forge-text)" }}
          >
            {meta.name}
          </h2>
        </div>
        <button
          onClick={onReset}
          className="text-xs font-mono px-3 py-2 rounded transition-colors shrink-0"
          style={{ border: "1px solid var(--forge-border)", color: "var(--forge-muted)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--forge-text)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--forge-muted)"; }}
        >
          ← New Preset
        </button>
      </div>

      <p className="text-sm leading-relaxed" style={{ color: "var(--forge-muted)" }}>
        {meta.description}
      </p>

      {/* Signal chain */}
      <div>
        <p className="text-xs font-mono mb-3 tracking-widest" style={{ color: "var(--forge-faint)" }}>
          SIGNAL CHAIN
        </p>
        <div
          className="p-4 rounded-lg flex flex-wrap gap-y-2 items-center"
          style={{ background: "var(--forge-iron)", border: "1px solid var(--forge-border)" }}
        >
          {meta.chain.map((block, i) => (
            <ChainPill key={i} label={block} index={i} total={meta.chain.length} />
          ))}
        </div>
      </div>

      {/* Snapshots */}
      <div>
        <p className="text-xs font-mono mb-3 tracking-widest" style={{ color: "var(--forge-faint)" }}>
          SNAPSHOTS
        </p>
        <div className="flex flex-wrap gap-2">
          {meta.snapshots.map((snap, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono"
              style={{
                background: "var(--forge-steel)",
                border: `1px solid ${isCover ? `${sectionColor(i)}33` : "var(--forge-border)"}`,
                color: isCover ? sectionColor(i) : i === 0 ? "var(--forge-arc)" : "var(--forge-muted)",
              }}
            >
              <span style={{ color: "var(--forge-faint)" }}>{i + 1}</span>
              {snap}
            </div>
          ))}
        </div>
      </div>

      {/* MIDI map — cover song only */}
      {isCover && meta.sections && meta.midiInfo && (
        <MidiMap sections={meta.sections} midiInfo={meta.midiInfo} />
      )}

      {/* Downloads */}
      <div className="flex flex-col gap-3">
        {hsp && (
          <button
            onClick={() => downloadHsp(hsp, meta.name)}
            className="flex items-center justify-center gap-3 w-full py-4 rounded text-sm font-bold font-mono transition-all duration-200"
            style={{ background: "var(--forge-ember)", color: "var(--forge-black)", boxShadow: "0 0 20px rgba(255,107,26,0.3)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--forge-glow)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--forge-ember)"; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download {meta.name}.hsp
          </button>
        )}
        {!hsp && (
          <div
            className="text-center py-3 px-4 rounded text-xs font-mono"
            style={{
              background: "rgba(74,240,255,0.08)",
              border: "1px solid rgba(74,240,255,0.2)",
              color: "var(--forge-arc)",
            }}
          >
            ⚡ MIDI-only mode — no preset to download.<br />
            On Stadium, manually load any factory preset that matches the song&apos;s tone — the MIDI automation switches its snapshots in time.
          </div>
        )}

        {isCover && meta.sections && meta.midiInfo && (
          <button
            onClick={() => downloadMidi(
              meta.sections!,
              meta.midiInfo!,
              meta.name,
              meta.midiInfo?.presetSlot
                ? { presetSlot: meta.midiInfo.presetSlot, setlistBank: meta.midiInfo.setlistBank ?? "1" }
                : undefined,
              meta.midiInfo?.projectBpm ? parseFloat(meta.midiInfo.projectBpm) : undefined
            )}
            className="flex items-center justify-center gap-3 w-full py-3.5 rounded text-sm font-bold font-mono transition-all duration-200"
            style={{
              background: "transparent",
              border: "1px solid var(--forge-arc)",
              color: "var(--forge-arc)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(74,240,255,0.08)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download MIDI Automation (.mid)
          </button>
        )}
      </div>

      <p className="text-xs text-center" style={{ color: "var(--forge-faint)" }}>
        {isCover
          ? "Drag .hsp into HX Edit · Drag .mid onto a MIDI track → route to Helix"
          : "Import via HX Edit or copy to Helix preset folder"}
      </p>

      {/* Save to catalog */}
      <div className="flex items-center gap-3">
        <button
          onClick={saveTocatalog}
          disabled={saving || saved}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded text-xs font-mono font-bold transition-all"
          style={{
            background: saved ? "rgba(52,211,153,0.1)" : "transparent",
            border: `1px solid ${saved ? "rgba(52,211,153,0.4)" : "var(--forge-border)"}`,
            color: saved ? "#34d399" : "var(--forge-muted)",
          }}
          onMouseEnter={(e) => { if (!saved) (e.currentTarget as HTMLElement).style.borderColor = "var(--forge-ember)"; }}
          onMouseLeave={(e) => { if (!saved) (e.currentTarget as HTMLElement).style.borderColor = "var(--forge-border)"; }}
        >
          {saved ? (
            <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>Saved to Catalog</>
          ) : saving ? (
            <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>Saving...</>
          ) : (
            <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>Save to Catalog</>
          )}
        </button>

        {saved && (
          <Link href="/catalog"
            className="px-4 py-3 rounded text-xs font-mono font-bold transition-all"
            style={{ border: "1px solid var(--forge-border)", color: "var(--forge-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--forge-text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--forge-muted)")}
          >
            View Catalog →
          </Link>
        )}
      </div>

      {/* JSON viewer */}
      <div>
        <button
          onClick={() => setShowJson((v) => !v)}
          className="flex items-center gap-2 text-xs font-mono transition-colors"
          style={{ color: "var(--forge-faint)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--forge-muted)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--forge-faint)"; }}
        >
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ transform: showJson ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          {showJson ? "Hide" : "View"} preset JSON
        </button>

        {showJson && (
          <pre
            className="mt-3 p-4 rounded text-xs overflow-auto max-h-64"
            style={{
              background: "var(--forge-dark)",
              border: "1px solid var(--forge-border)",
              color: "var(--forge-muted)",
              fontFamily: "Geist Mono, monospace",
            }}
          >
            {JSON.stringify(hsp, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

/* ── Mode tab ── */
function ModeTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 py-2 rounded text-xs font-mono font-bold tracking-wider transition-all duration-200"
      style={{
        background: active ? "var(--forge-ember)" : "transparent",
        color: active ? "var(--forge-black)" : "var(--forge-muted)",
      }}
    >
      {label}
    </button>
  );
}

/* ── Input field ── */
function Field({
  label, value, onChange, placeholder, type = "text",
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-mono mb-2 tracking-widest" style={{ color: "var(--forge-faint)" }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-3 rounded text-sm font-mono outline-none transition-all"
        style={{ background: "var(--forge-iron)", border: "1px solid var(--forge-border)", color: "var(--forge-text)" }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "var(--forge-ember)")}
        onBlur={(e) => (e.currentTarget.style.borderColor = "var(--forge-border)")}
      />
    </div>
  );
}

function Select({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <label className="block text-xs font-mono mb-2 tracking-widest" style={{ color: "var(--forge-faint)" }}>
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-3 rounded text-sm font-mono outline-none transition-all cursor-pointer"
        style={{ background: "var(--forge-iron)", border: "1px solid var(--forge-border)", color: "var(--forge-text)" }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "var(--forge-ember)")}
        onBlur={(e) => (e.currentTarget.style.borderColor = "var(--forge-border)")}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

// All 128 preset slots (1A through 32D) + an explicit "manual" empty option
const PRESET_SLOT_OPTIONS: Array<{ value: string; label: string }> = (() => {
  const opts: Array<{ value: string; label: string }> = [
    { value: "", label: "— manual (no preset switch) —" },
  ];
  for (let bank = 1; bank <= 32; bank++) {
    for (const letter of ["A", "B", "C", "D"]) {
      opts.push({ value: `${bank}${letter}`, label: `${bank}${letter}` });
    }
  }
  return opts;
})();

const SETLIST_BANK_OPTIONS: Array<{ value: string; label: string }> = (() => {
  const opts: Array<{ value: string; label: string }> = [
    { value: "0", label: "Factory Presets (0)" },
    { value: "1", label: "User Group 1 (1)" },
    { value: "2", label: "User Group 2 (2)" },
    { value: "3", label: "User Group 3 (3)" },
    { value: "4", label: "User Group 4 (4)" },
  ];
  for (let i = 5; i <= 16; i++) {
    opts.push({ value: String(i), label: `Custom Setlist ${i}` });
  }
  return opts;
})();

/* ── Main ── */
export default function ForgePage() {
  const [mode, setMode] = useState<ForgeMode>("describe");
  const [description, setDescription] = useState("");
  const [presetName, setPresetName] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [coverNotes, setCoverNotes] = useState("");
  const [coverAudioFile, setCoverAudioFile] = useState<File | null>(null);
  const [coverAudioDragging, setCoverAudioDragging] = useState(false);
  // Preset address for the song's MIDI Program Change event (Option B)
  const [presetSlot, setPresetSlot] = useState("");      // e.g. "1A", "12C", "32D"
  const [setlistBank, setSetlistBank] = useState("1");   // CC32 value (1-4 = User Groups, 5+ = custom setlists)
  // User-provided markers (overrides lookup/audio detection if non-empty)
  const [markersText, setMarkersText] = useState("");
  // Song-start offset in the user's DAW project (e.g. "4:30") — subtracted from all markers
  const [songOffsetText, setSongOffsetText] = useState("");
  // Project BPM — used to generate the MIDI at matching tempo so events land on the right seconds
  const [projectBpm, setProjectBpm] = useState("120");
  // Screenshot → markers OCR
  const [parsingScreenshot, setParsingScreenshot] = useState(false);
  const [screenshotError, setScreenshotError] = useState("");
  // Saved songs picker
  type SavedPreset = {
    id: string;
    preset_name: string;
    song_title: string | null;
    artist: string | null;
    midi_info: { presetSlot?: string; setlistBank?: string; markersText?: string; songOffsetText?: string } | null;
  };
  const [savedSongs, setSavedSongs] = useState<SavedPreset[]>([]);
  const [showSavedPicker, setShowSavedPicker] = useState(false);

  const loadSavedSongs = useCallback(async () => {
    try {
      const res = await fetch("/api/presets");
      if (!res.ok) return;
      const data = (await res.json()) as SavedPreset[];
      setSavedSongs(data.filter((p) => p.song_title));
    } catch (e) {
      console.warn("Couldn't load saved songs:", e);
    }
  }, []);

  const applySavedSong = useCallback((p: SavedPreset) => {
    setSongTitle(p.song_title ?? "");
    setArtist(p.artist ?? "");
    setMarkersText(p.midi_info?.markersText ?? "");
    setSongOffsetText(p.midi_info?.songOffsetText ?? "");
    setPresetSlot(p.midi_info?.presetSlot ?? "");
    setSetlistBank(p.midi_info?.setlistBank ?? "1");
    setShowSavedPicker(false);
  }, []);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<ForgeStatus>("idle");
  const [result, setResult] = useState<ForgeResult | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AudioAnalysisResult | null>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverFileInputRef = useRef<HTMLInputElement>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);

  const handleScreenshotFile = useCallback(async (file: File) => {
    setScreenshotError("");
    setParsingScreenshot(true);
    try {
      const reader = new FileReader();
      const dataUrl: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

      const res = await fetch("/api/parse-markers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: dataUrl, mediaType: file.type || "image/png" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Marker parsing failed");

      const newMarkers = data.markersText as string;
      // Append to existing markers if user already typed some — otherwise replace
      setMarkersText((prev) => (prev.trim() ? prev.trimEnd() + "\n" + newMarkers : newMarkers));
    } catch (e) {
      setScreenshotError(e instanceof Error ? e.message : "Couldn't parse screenshot");
    } finally {
      setParsingScreenshot(false);
    }
  }, []);

  const canForge =
    (mode === "describe" && description.trim().length > 0) ||
    (mode === "cover" && songTitle.trim().length > 0 && artist.trim().length > 0) ||
    (mode === "upload" && (audioFile !== null || description.trim().length > 0));

  const isActive = status === "analyzing" || status === "forging";

  const forge = useCallback(async (midiOnly = false) => {
    if (!canForge || isActive) return;
    setError("");
    setResult(null);
    setAnalysisResult(null);

    let audioAnalysis: string | undefined;
    let audioSections: Array<{ startSec: number; endSec: number; energyLevel: string }> | undefined;
    let audioDurationSec: number | undefined;
    let audioSongStartSec: number | undefined;

    // Analyze audio if cover + file uploaded. Run for BOTH full-forge and
    // midi-only modes. In midi-only the audio gives us the preroll length
    // and total duration; lookup gives us the section structure; we scale
    // and offset lookup timestamps to map cleanly onto the user's track.
    if (mode === "cover" && coverAudioFile) {
      setStatus("analyzing");
      try {
        const result = await analyzeAudioFile(coverAudioFile);
        setAnalysisResult(result);
        audioAnalysis = result.summary;
        audioSections = result.sections.map((s) => ({
          startSec: s.startSec,
          endSec: s.endSec,
          energyLevel: s.energyLevel,
        }));
        audioDurationSec = result.durationSec;
        // Find first non-quiet section — that's where the actual song begins
        // after click preroll/silence.
        const firstReal = result.sections.find((s) => s.energyLevel !== "quiet");
        audioSongStartSec = firstReal?.startSec ?? 0;
      } catch (e) {
        console.warn("Audio analysis failed, continuing without it:", e);
      }
    }

    setStatus("forging");

    try {
      const body =
        mode === "cover"
          ? { mode: "cover", songTitle, artist, notes: coverNotes, audioAnalysis, audioSections, audioDurationSec, audioSongStartSec, midiOnly, presetSlot, setlistBank, markersText, songOffsetText, projectBpm }
          : { mode: "describe", description: description || `Tone from audio: ${audioFile?.name}`, presetName };

      const res = await fetch("/api/forge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setResult(data);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStatus("error");
    }
  }, [canForge, isActive, mode, description, presetName, songTitle, artist, coverNotes, coverAudioFile, audioFile, presetSlot, setlistBank, markersText, songOffsetText, projectBpm]);

  const reset = () => {
    setStatus("idle");
    setResult(null);
    setAnalysisResult(null);
    setError("");
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--forge-black)" }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-8 py-5 shrink-0"
        style={{ borderBottom: "1px solid var(--forge-border)" }}
      >
        <Link href="/" className="flex items-center gap-3 transition-opacity hover:opacity-70">
          <div
            className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold"
            style={{ background: "var(--forge-ember)", color: "var(--forge-black)", fontFamily: "Geist Mono, monospace" }}
          >
            HF
          </div>
          <span className="text-sm font-mono" style={{ color: "var(--forge-muted)" }}>← HelixForge</span>
        </Link>
        <h1 className="text-sm font-mono font-bold tracking-widest" style={{ color: "var(--forge-ember)" }}>
          THE FORGE
        </h1>
        <div className="w-28" />
      </header>

      {/* Body */}
      <div className="flex flex-col lg:flex-row flex-1">
        {/* Input panel */}
        <div
          className="lg:w-[460px] xl:w-[520px] shrink-0 flex flex-col p-8 gap-5"
          style={{ borderRight: "1px solid var(--forge-border)" }}
        >
          {/* Mode toggle */}
          <div className="flex gap-1 p-1 rounded" style={{ background: "var(--forge-iron)" }}>
            <ModeTab label="DESCRIBE" active={mode === "describe"} onClick={() => setMode("describe")} />
            <ModeTab label="COVER SONG" active={mode === "cover"} onClick={() => setMode("cover")} />
            <ModeTab label="UPLOAD" active={mode === "upload"} onClick={() => setMode("upload")} />
          </div>

          {/* ── DESCRIBE mode ── */}
          {mode === "describe" && (
            <>
              <Field label="PRESET NAME" value={presetName} onChange={setPresetName} placeholder="My Texas Blues..." />

              <div className="flex-1 flex flex-col">
                <label className="block text-xs font-mono mb-2 tracking-widest" style={{ color: "var(--forge-faint)" }}>
                  DESCRIBE YOUR TONE
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) forge(); }}
                  placeholder="SRV-style Texas blues — warm, glassy clean with a Tube Screamer pushing a Fender Deluxe into the edge of breakup. Sings on bends, barks on the attack. Spring reverb, light slapback delay..."
                  rows={8}
                  className="w-full px-4 py-3 rounded text-sm outline-none resize-none"
                  style={{
                    background: "var(--forge-iron)", border: "1px solid var(--forge-border)",
                    color: "var(--forge-text)", fontFamily: "system-ui, sans-serif", lineHeight: "1.7",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--forge-ember)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--forge-border)")}
                />
                <p className="text-xs mt-1.5" style={{ color: "var(--forge-faint)" }}>⌘↵ to forge</p>
              </div>

              <div>
                <p className="text-xs font-mono mb-2.5 tracking-widest" style={{ color: "var(--forge-faint)" }}>QUICK EXAMPLES</p>
                <div className="flex flex-wrap gap-2">
                  {DESCRIBE_EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => setDescription(ex)}
                      className="px-3 py-1.5 rounded text-xs transition-all duration-150"
                      style={{ background: "var(--forge-steel)", border: "1px solid var(--forge-border)", color: "var(--forge-muted)" }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,107,26,0.4)";
                        (e.currentTarget as HTMLElement).style.color = "var(--forge-text)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--forge-border)";
                        (e.currentTarget as HTMLElement).style.color = "var(--forge-muted)";
                      }}
                    >
                      {ex.split(" - ")[0]}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── COVER SONG mode ── */}
          {mode === "cover" && (
            <>
              {/* Load a previously-saved song's config (markers, slot, etc.) */}
              <div>
                <button
                  type="button"
                  onClick={() => {
                    if (!showSavedPicker) loadSavedSongs();
                    setShowSavedPicker(!showSavedPicker);
                  }}
                  className="w-full text-xs font-mono px-3 py-2 rounded transition-all"
                  style={{
                    background: showSavedPicker ? "rgba(74,240,255,0.08)" : "transparent",
                    border: "1px solid var(--forge-arc)",
                    color: "var(--forge-arc)",
                  }}
                >
                  {showSavedPicker ? "▾" : "▸"} 📚 LOAD SAVED SONG (for shuffled setlists)
                </button>
                {showSavedPicker && (
                  <div className="mt-2 max-h-60 overflow-y-auto rounded border" style={{ borderColor: "var(--forge-border)" }}>
                    {savedSongs.length === 0 ? (
                      <div className="p-3 text-xs font-mono text-center" style={{ color: "var(--forge-faint)" }}>
                        No saved songs yet. Generate one and click &quot;Save to Catalog&quot; to start a library.
                      </div>
                    ) : (
                      savedSongs.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => applySavedSong(p)}
                          className="w-full text-left px-3 py-2 text-xs font-mono transition-colors"
                          style={{ borderBottom: "1px solid var(--forge-border)", color: "var(--forge-text)" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(74,240,255,0.05)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                          <div style={{ color: "var(--forge-text)" }}>{p.song_title}</div>
                          <div style={{ color: "var(--forge-faint)" }}>
                            {p.artist}
                            {p.midi_info?.presetSlot ? ` · slot ${p.midi_info.presetSlot}` : ""}
                            {p.midi_info?.setlistBank ? ` · bank ${p.midi_info.setlistBank}` : ""}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              <Field label="SONG TITLE" value={songTitle} onChange={setSongTitle} placeholder="Comfortably Numb" />
              <Field label="ARTIST" value={artist} onChange={setArtist} placeholder="Pink Floyd" />

              {/* Preset address for full MIDI automation */}
              <div className="grid grid-cols-2 gap-3">
                <Select
                  label="PRESET SLOT"
                  value={presetSlot}
                  onChange={setPresetSlot}
                  options={PRESET_SLOT_OPTIONS}
                />
                <Select
                  label="SETLIST / BANK"
                  value={setlistBank}
                  onChange={setSetlistBank}
                  options={SETLIST_BANK_OPTIONS}
                />
              </div>
              <p className="text-xs font-mono -mt-1" style={{ color: "var(--forge-faint)" }}>
                Pick the slot where this song&apos;s preset lives on Stadium → MIDI auto-loads it before the song. Leave as &quot;manual&quot; if you switch presets yourself.
              </p>

              {/* Song offset + project BPM */}
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="SONG STARTS AT (optional)"
                  value={songOffsetText}
                  onChange={setSongOffsetText}
                  placeholder="0:00"
                />
                <Field
                  label="PROJECT BPM"
                  value={projectBpm}
                  onChange={setProjectBpm}
                  placeholder="120"
                  type="number"
                />
              </div>
              <p className="text-xs font-mono -mt-1" style={{ color: "var(--forge-faint)" }}>
                <strong>SONG STARTS AT:</strong> for multi-song projects, type when this song begins (else leave blank for literal marker times). <strong>PROJECT BPM:</strong> match your Cubase project tempo so MIDI events land on the right seconds — Cubase scales ticks against this.
              </p>

              {/* Manual markers — overrides auto-detection when provided */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-mono tracking-widest" style={{ color: "var(--forge-faint)" }}>
                    MARKERS <span style={{ color: "var(--forge-arc)" }}>← paste/type/screenshot from your DAW</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => screenshotInputRef.current?.click()}
                    disabled={parsingScreenshot}
                    className="text-xs font-mono px-3 py-1.5 rounded transition-all"
                    style={{
                      background: "transparent",
                      border: "1px solid var(--forge-arc)",
                      color: parsingScreenshot ? "var(--forge-faint)" : "var(--forge-arc)",
                      cursor: parsingScreenshot ? "wait" : "pointer",
                    }}
                    onMouseEnter={(e) => { if (!parsingScreenshot) (e.currentTarget as HTMLElement).style.background = "rgba(74,240,255,0.08)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                    title="Upload a screenshot of your DAW Marker Window — Claude reads it and fills the markers below"
                  >
                    {parsingScreenshot ? "📸 reading…" : "📸 upload screenshot"}
                  </button>
                  <input
                    ref={screenshotInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleScreenshotFile(f);
                      if (e.target) e.target.value = "";
                    }}
                  />
                </div>
                <textarea
                  value={markersText}
                  onChange={(e) => setMarkersText(e.target.value)}
                  onPaste={(e) => {
                    // If the user pastes an image (Ctrl+V from clipboard after a Snip/Print Screen),
                    // intercept it and run through the OCR endpoint instead.
                    const items = e.clipboardData?.items;
                    if (!items) return;
                    for (const it of items) {
                      if (it.type.startsWith("image/")) {
                        e.preventDefault();
                        const blob = it.getAsFile();
                        if (blob) handleScreenshotFile(blob);
                        return;
                      }
                    }
                  }}
                  placeholder={"4:30 INTRO\n4:38 VERSE 1\n4:54 CHORUS\n5:18 VERSE 2\n5:42 SOLO\n6:06 CHORUS\n6:30 OUTRO\n\n— or hit 📸 to upload a screenshot of your DAW Marker Window —"}
                  rows={7}
                  className="w-full px-4 py-3 rounded text-sm font-mono outline-none transition-all resize-y"
                  style={{ background: "var(--forge-iron)", border: "1px solid var(--forge-border)", color: "var(--forge-text)" }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--forge-ember)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--forge-border)")}
                />
                {screenshotError && (
                  <p className="text-xs font-mono mt-1" style={{ color: "#ef4444" }}>
                    {screenshotError}
                  </p>
                )}
                <p className="text-xs font-mono mt-1" style={{ color: "var(--forge-faint)" }}>
                  One per line: <code>M:SS NAME</code> or <code>M:SS.SS NAME</code>. Type, paste from clipboard (text or screenshot), or hit 📸 to upload an image of the marker window. Absolute Cubase timestamps — HelixForge subtracts the song-start offset above.
                </p>
              </div>

              {/* Audio upload — the real thing */}
              <div>
                <label className="block text-xs font-mono mb-2 tracking-widest" style={{ color: "var(--forge-faint)" }}>
                  UPLOAD SONG AUDIO <span style={{ color: "var(--forge-arc)" }}>← makes tones accurate</span>
                </label>
                <div
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed transition-all duration-200 p-5 text-center cursor-pointer"
                  style={{
                    borderColor: coverAudioDragging ? "var(--forge-arc)" : coverAudioFile ? "rgba(74,240,255,0.4)" : "var(--forge-border)",
                    background: coverAudioDragging ? "rgba(74,240,255,0.05)" : coverAudioFile ? "rgba(74,240,255,0.04)" : "var(--forge-iron)",
                    minHeight: 80,
                  }}
                  onDragOver={(e) => { e.preventDefault(); setCoverAudioDragging(true); }}
                  onDragLeave={() => setCoverAudioDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault(); setCoverAudioDragging(false);
                    const f = e.dataTransfer.files[0];
                    if (f) setCoverAudioFile(f);
                  }}
                  onClick={() => coverFileInputRef.current?.click()}
                >
                  <input ref={coverFileInputRef} type="file" className="hidden" accept="audio/*"
                    onChange={(e) => e.target.files?.[0] && setCoverAudioFile(e.target.files[0])} />

                  {coverAudioFile ? (
                    <div className="flex items-center gap-3 w-full">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--forge-arc)", flexShrink: 0 }}>
                        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                      </svg>
                      <span className="text-sm font-mono truncate" style={{ color: "var(--forge-arc)" }}>
                        {coverAudioFile.name}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setCoverAudioFile(null); }}
                        className="ml-auto text-xs shrink-0 transition-colors"
                        style={{ color: "var(--forge-faint)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--forge-muted)")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--forge-faint)")}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--forge-muted)" }}>
                        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                      </svg>
                      <span className="text-sm" style={{ color: "var(--forge-muted)" }}>
                        Drop song file or click to browse
                      </span>
                      <span className="text-xs" style={{ color: "var(--forge-faint)" }}>MP3 · WAV · M4A</span>
                    </div>
                  )}
                </div>
                {!coverAudioFile && (
                  <p className="text-xs mt-1.5" style={{ color: "var(--forge-faint)" }}>
                    Without audio: Claude uses training data knowledge only — still good for popular songs
                  </p>
                )}
                {coverAudioFile && (
                  <p className="text-xs mt-1.5" style={{ color: "var(--forge-arc)" }}>
                    ✓ Will analyze frequency content + drive levels per section before forging
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-mono mb-2 tracking-widest" style={{ color: "var(--forge-faint)" }}>
                  NOTES (optional)
                </label>
                <textarea
                  value={coverNotes}
                  onChange={(e) => setCoverNotes(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) forge(); }}
                  placeholder="Playing the Gilmour solo parts on a Strat. Need the clean verse and the big sustain-y lead for both solos..."
                  rows={3}
                  className="w-full px-4 py-3 rounded text-sm outline-none resize-none"
                  style={{
                    background: "var(--forge-iron)", border: "1px solid var(--forge-border)",
                    color: "var(--forge-text)", fontFamily: "system-ui, sans-serif", lineHeight: "1.7",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--forge-ember)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--forge-border)")}
                />
                <p className="text-xs mt-1.5" style={{ color: "var(--forge-faint)" }}>⌘↵ to forge</p>
              </div>
            </>
          )}

          {/* ── UPLOAD mode ── */}
          {mode === "upload" && (
            <>
              <div
                className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed transition-all duration-200 p-8 text-center min-h-44 cursor-pointer"
                style={{
                  borderColor: isDragging ? "var(--forge-ember)" : "var(--forge-border)",
                  background: isDragging ? "rgba(255,107,26,0.05)" : "var(--forge-iron)",
                }}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault(); setIsDragging(false);
                  const file = e.dataTransfer.files[0];
                  if (file) setAudioFile(file);
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <input ref={fileInputRef} type="file" className="hidden" accept="audio/*"
                  onChange={(e) => e.target.files?.[0] && setAudioFile(e.target.files[0])} />
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3"
                  style={{ color: audioFile ? "var(--forge-ember)" : "var(--forge-muted)" }}>
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                </svg>
                {audioFile ? (
                  <p className="text-sm font-mono" style={{ color: "var(--forge-ember)" }}>{audioFile.name}</p>
                ) : (
                  <>
                    <p className="text-sm font-mono mb-1" style={{ color: "var(--forge-muted)" }}>Drop audio clip here</p>
                    <p className="text-xs" style={{ color: "var(--forge-faint)" }}>MP3, WAV, M4A — or click to browse</p>
                  </>
                )}
              </div>

              <div className="flex items-start gap-2.5 px-3 py-3 rounded text-xs"
                style={{ background: "rgba(74,240,255,0.05)", border: "1px solid rgba(74,240,255,0.15)", color: "var(--forge-arc)" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 mt-0.5">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                Audio analysis coming soon. Add a description to guide the forge.
              </div>

              <div>
                <label className="block text-xs font-mono mb-2 tracking-widest" style={{ color: "var(--forge-faint)" }}>
                  TONE DESCRIPTION
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the tone in this clip..."
                  rows={4}
                  className="w-full px-4 py-3 rounded text-sm outline-none resize-none"
                  style={{
                    background: "var(--forge-iron)", border: "1px solid var(--forge-border)",
                    color: "var(--forge-text)", fontFamily: "system-ui, sans-serif",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--forge-ember)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--forge-border)")}
                />
              </div>
            </>
          )}

          {/* Error */}
          {status === "error" && (
            <div
              className="flex items-start gap-3 px-4 py-3 rounded text-sm"
              style={{ background: "rgba(255,50,50,0.08)", border: "1px solid rgba(255,50,50,0.3)", color: "#ff6b6b" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          {/* Forge buttons */}
          <div className="flex flex-col gap-2 mt-auto">
            <button
              onClick={() => forge(false)}
              disabled={!canForge || isActive}
              className="w-full py-4 rounded text-sm font-bold font-mono flex items-center justify-center gap-3 transition-all duration-200"
              style={{
                background: isActive ? "var(--forge-dim)" : canForge ? "var(--forge-ember)" : "var(--forge-iron)",
                color: canForge ? "var(--forge-black)" : "var(--forge-faint)",
                cursor: !canForge || isActive ? "not-allowed" : "pointer",
                boxShadow: canForge && !isActive ? "0 0 20px rgba(255,107,26,0.25)" : "none",
              }}
              onMouseEnter={(e) => { if (canForge && !isActive) (e.currentTarget as HTMLElement).style.background = "var(--forge-glow)"; }}
              onMouseLeave={(e) => { if (canForge && !isActive) (e.currentTarget as HTMLElement).style.background = "var(--forge-ember)"; }}
            >
              {status === "analyzing" ? (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  ANALYZING AUDIO...
                </>
              ) : status === "forging" ? (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  {mode === "cover" ? "FORGING COVER PRESET..." : "FORGING..."}
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                  {mode === "cover" ? "FORGE COVER PRESET" : "FORGE PRESET"}
                </>
              )}
            </button>

            {mode === "cover" && (
              <button
                onClick={() => forge(true)}
                disabled={!canForge || isActive}
                className="w-full py-3 rounded text-xs font-bold font-mono flex items-center justify-center gap-2 transition-all duration-200"
                style={{
                  background: "transparent",
                  border: "1px solid var(--forge-arc)",
                  color: canForge && !isActive ? "var(--forge-arc)" : "var(--forge-faint)",
                  cursor: !canForge || isActive ? "not-allowed" : "pointer",
                }}
                onMouseEnter={(e) => { if (canForge && !isActive) (e.currentTarget as HTMLElement).style.background = "rgba(74,240,255,0.08)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                title="Skips preset generation (zero brick risk). Generates only the MIDI automation track. Use a factory preset on Stadium that matches the song."
              >
                ⚡ MIDI ONLY (SAFE) — no preset, just automation
              </button>
            )}
          </div>
        </div>

        {/* Output panel */}
        <div className="flex-1 overflow-y-auto p-8">
          {status === "idle" || (status === "error" && !result) ? (
            <IdleState mode={mode} />
          ) : status === "analyzing" || status === "forging" ? (
            <ForgingState status={status} mode={mode} analysisResult={analysisResult} />
          ) : result ? (
            <ResultState result={result} onReset={reset} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
