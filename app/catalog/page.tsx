"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Preset {
  id: string;
  created_at: string;
  mode: string;
  preset_name: string;
  song_title: string | null;
  artist: string | null;
  description: string | null;
  chain: string[];
  snapshots: (string | null)[];
  sections: { name: string; snapshotIndex: number; approxTimestamp: string; toneDescription: string; midiCCValue: number }[] | null;
  midi_info: { cc: number; channel: number; note: string } | null;
}

function downloadHsp(hsp: object, name: string) {
  const blob = new Blob(["rpshnosj" + JSON.stringify(hsp)], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9]/gi, "_")}.hsp`;
  a.click();
  URL.revokeObjectURL(url);
}

function generateMidiFile(sections: NonNullable<Preset["sections"]>, midiInfo: NonNullable<Preset["midi_info"]>): Uint8Array {
  const PPQ = 480;
  const BPM = 120;
  const TICKS_PER_SEC = (BPM / 60) * PPQ;

  function tsToSeconds(ts: string): number {
    const parts = ts.split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
  }

  function vlq(value: number): number[] {
    if (value < 0x80) return [value];
    const out: number[] = [];
    out.unshift(value & 0x7F);
    value >>= 7;
    while (value > 0) { out.unshift((value & 0x7F) | 0x80); value >>= 7; }
    return out;
  }

  const events: number[] = [];
  const tempoUs = Math.round(60_000_000 / BPM);
  events.push(...vlq(0), 0xFF, 0x51, 0x03, (tempoUs >> 16) & 0xFF, (tempoUs >> 8) & 0xFF, tempoUs & 0xFF);

  const ch = Math.max(0, Math.min(15, (midiInfo.channel ?? 1) - 1));
  let prevTick = 0;
  for (const s of sections) {
    const tick = Math.round(tsToSeconds(s.approxTimestamp) * TICKS_PER_SEC);
    const delta = Math.max(0, tick - prevTick);
    prevTick = tick;
    events.push(...vlq(delta), 0xB0 | ch, midiInfo.cc & 0x7F, s.midiCCValue & 0x7F);
  }
  events.push(...vlq(0), 0xFF, 0x2F, 0x00);

  const header = [0x4D, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, (PPQ >> 8) & 0xFF, PPQ & 0xFF];
  const tl = events.length;
  const track = [0x4D, 0x54, 0x72, 0x6B, (tl >> 24) & 0xFF, (tl >> 16) & 0xFF, (tl >> 8) & 0xFF, tl & 0xFF, ...events];
  return new Uint8Array([...header, ...track]);
}

function downloadMidi(sections: NonNullable<Preset["sections"]>, midiInfo: NonNullable<Preset["midi_info"]>, name: string) {
  const bytes = generateMidiFile(sections, midiInfo);
  const blob = new Blob([bytes], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9]/gi, "_")}_midi_map.mid`;
  a.click();
  URL.revokeObjectURL(url);
}

function sectionColor(i: number) {
  return ["var(--forge-arc)", "var(--forge-ember)", "var(--forge-hot)", "#a78bfa", "var(--forge-glow)", "#34d399", "#f472b6", "var(--forge-muted)"][i % 8];
}

function PresetCard({ preset, onDelete }: { preset: Preset; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [hsp, setHsp] = useState<object | null>(null);
  const [loadingHsp, setLoadingHsp] = useState(false);
  const isCover = preset.mode === "cover";

  async function fetchAndDownloadHsp(action: "hsp" | "midi") {
    if (loadingHsp) return;
    setLoadingHsp(true);
    try {
      const res = await fetch(`/api/presets/${preset.id}`);
      const data = await res.json();
      setHsp(data.hsp);
      if (action === "hsp") downloadHsp(data.hsp, preset.preset_name);
      else if (action === "midi" && preset.sections && preset.midi_info)
        downloadMidi(preset.sections, preset.midi_info, preset.preset_name);
    } finally {
      setLoadingHsp(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${preset.preset_name}"?`)) return;
    setDeleting(true);
    await fetch(`/api/presets/${preset.id}`, { method: "DELETE" });
    onDelete(preset.id);
  }

  const date = new Date(preset.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div
      className="rounded-lg transition-all duration-200"
      style={{ background: "var(--forge-steel)", border: "1px solid var(--forge-border)" }}
    >
      {/* Card header */}
      <div
        className="flex items-start justify-between gap-4 p-5 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className="px-2 py-0.5 rounded text-xs font-mono"
              style={{
                background: isCover ? "rgba(255,107,26,0.12)" : "rgba(74,240,255,0.08)",
                color: isCover ? "var(--forge-ember)" : "var(--forge-arc)",
                border: `1px solid ${isCover ? "rgba(255,107,26,0.3)" : "rgba(74,240,255,0.2)"}`,
              }}
            >
              {isCover ? "COVER" : "DESCRIBE"}
            </span>
            <span className="text-xs font-mono" style={{ color: "var(--forge-faint)" }}>{date}</span>
          </div>
          <h3 className="text-base font-bold truncate" style={{ fontFamily: "Geist Mono, monospace", color: "var(--forge-text)" }}>
            {preset.preset_name}
          </h3>
          {isCover && preset.artist && (
            <p className="text-sm mt-0.5" style={{ color: "var(--forge-muted)" }}>
              {preset.song_title} — {preset.artist}
            </p>
          )}
          {!isCover && preset.description && (
            <p className="text-sm mt-0.5 truncate" style={{ color: "var(--forge-muted)" }}>{preset.description}</p>
          )}
        </div>

        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ color: "var(--forge-faint)", transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-5 pb-5 flex flex-col gap-4" style={{ borderTop: "1px solid var(--forge-border)" }}>
          {/* Chain */}
          <div className="pt-4">
            <p className="text-xs font-mono mb-2 tracking-widest" style={{ color: "var(--forge-faint)" }}>SIGNAL CHAIN</p>
            <div className="flex flex-wrap gap-y-1 items-center gap-0"
              style={{ background: "var(--forge-iron)", border: "1px solid var(--forge-border)", borderRadius: 8, padding: "10px 12px" }}>
              {preset.chain?.map((block, i) => {
                const isAmp = /amp|twin|deluxe|princeton|plexi|jcm|vox|mesa|orange|friedman|evh|matchless|dumble/i.test(block);
                const isCab = /cab|4x12|2x12|1x12|greenback|vintage|alnico/i.test(block);
                const isIo  = i === 0 || i === preset.chain.length - 1;
                const color = isAmp ? "var(--forge-ember)" : isCab ? "var(--forge-glow)" : isIo ? "var(--forge-faint)" : "var(--forge-muted)";
                const bg    = isAmp ? "rgba(255,107,26,0.12)" : isCab ? "rgba(255,107,26,0.06)" : "transparent";
                const border = isAmp ? "var(--forge-ember)" : isCab ? "rgba(255,107,26,0.4)" : "var(--forge-border)";
                return (
                  <div key={i} className="flex items-center">
                    <span className="px-2.5 py-1 rounded text-xs font-mono whitespace-nowrap"
                      style={{ color, background: bg, border: `1px solid ${border}` }}>{block}</span>
                    {i < preset.chain.length - 1 && (
                      <div className="flex items-center px-1">
                        <div className="w-3 h-px" style={{ background: "var(--forge-faint)" }} />
                        <div className="w-0 h-0" style={{ borderTop: "3px solid transparent", borderBottom: "3px solid transparent", borderLeft: "4px solid var(--forge-faint)" }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Snapshots */}
          <div>
            <p className="text-xs font-mono mb-2 tracking-widest" style={{ color: "var(--forge-faint)" }}>SNAPSHOTS</p>
            <div className="flex flex-wrap gap-1.5">
              {preset.snapshots?.map((snap, i) => snap ? (
                <div key={i} className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono"
                  style={{ background: "var(--forge-iron)", border: `1px solid ${sectionColor(i)}33`, color: sectionColor(i) }}>
                  <span style={{ color: "var(--forge-faint)" }}>{i + 1}</span>{snap}
                </div>
              ) : null)}
            </div>
          </div>

          {/* MIDI map for cover presets */}
          {isCover && preset.sections && (
            <div>
              <p className="text-xs font-mono mb-2 tracking-widest" style={{ color: "var(--forge-faint)" }}>MIDI MAP</p>
              <div className="rounded overflow-hidden" style={{ border: "1px solid var(--forge-border)" }}>
                <div className="grid text-xs font-mono px-3 py-2" style={{ gridTemplateColumns: "60px 80px 1fr", background: "var(--forge-iron)", color: "var(--forge-faint)", borderBottom: "1px solid var(--forge-border)" }}>
                  <span>TIME</span><span>CC69</span><span>SECTION</span>
                </div>
                {preset.sections.map((s, i) => (
                  <div key={i} className="grid text-xs px-3 py-2 items-center"
                    style={{ gridTemplateColumns: "60px 80px 1fr", background: i % 2 === 0 ? "var(--forge-dark)" : "var(--forge-steel)", borderBottom: i < preset.sections!.length - 1 ? "1px solid var(--forge-border)" : "none" }}>
                    <span className="font-mono font-bold" style={{ color: sectionColor(s.snapshotIndex) }}>{s.approxTimestamp}</span>
                    <span className="font-mono" style={{ color: "var(--forge-muted)" }}>→ {s.midiCCValue}</span>
                    <span style={{ color: "var(--forge-muted)" }}>{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={() => fetchAndDownloadHsp("hsp")}
              disabled={loadingHsp}
              className="flex items-center gap-2 px-4 py-2 rounded text-xs font-mono font-bold transition-all"
              style={{ background: "var(--forge-ember)", color: "var(--forge-black)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--forge-glow)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--forge-ember)")}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {loadingHsp ? "Loading..." : "Download .hsp"}
            </button>

            {isCover && preset.sections && preset.midi_info && (
              <button
                onClick={() => fetchAndDownloadHsp("midi")}
                disabled={loadingHsp}
                className="flex items-center gap-2 px-4 py-2 rounded text-xs font-mono font-bold transition-all"
                style={{ background: "transparent", border: "1px solid var(--forge-arc)", color: "var(--forge-arc)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(74,240,255,0.08)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download MIDI
              </button>
            )}

            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-2 px-4 py-2 rounded text-xs font-mono transition-all ml-auto"
              style={{ border: "1px solid rgba(255,50,50,0.3)", color: "rgba(255,100,100,0.7)" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,50,50,0.6)";
                (e.currentTarget as HTMLElement).style.color = "#ff6b6b";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,50,50,0.3)";
                (e.currentTarget as HTMLElement).style.color = "rgba(255,100,100,0.7)";
              }}
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CatalogPage() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "cover" | "describe">("all");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/presets");
    const data = await res.json();
    setPresets(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = presets.filter((p) => {
    if (filter !== "all" && p.mode !== filter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.preset_name?.toLowerCase().includes(q) ||
      p.song_title?.toLowerCase().includes(q) ||
      p.artist?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen" style={{ background: "var(--forge-black)" }}>
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-5" style={{ borderBottom: "1px solid var(--forge-border)" }}>
        <Link href="/" className="flex items-center gap-3 transition-opacity hover:opacity-70">
          <div className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold"
            style={{ background: "var(--forge-ember)", color: "var(--forge-black)", fontFamily: "Geist Mono, monospace" }}>
            HF
          </div>
          <span className="text-sm font-mono" style={{ color: "var(--forge-muted)" }}>← HelixForge</span>
        </Link>
        <h1 className="text-sm font-mono font-bold tracking-widest" style={{ color: "var(--forge-ember)" }}>
          PRESET CATALOG
        </h1>
        <Link
          href="/forge"
          className="px-4 py-2 rounded text-xs font-mono font-bold transition-all"
          style={{ background: "var(--forge-ember)", color: "var(--forge-black)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--forge-glow)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--forge-ember)")}
        >
          + New Preset
        </Link>
      </header>

      <div className="max-w-4xl mx-auto px-8 py-10">
        {/* Search + filter */}
        <div className="flex gap-3 mb-8 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search presets, songs, artists..."
            className="flex-1 px-4 py-2.5 rounded text-sm outline-none transition-all min-w-48"
            style={{ background: "var(--forge-iron)", border: "1px solid var(--forge-border)", color: "var(--forge-text)", fontFamily: "system-ui" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--forge-ember)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--forge-border)")}
          />
          <div className="flex gap-1 p-1 rounded" style={{ background: "var(--forge-iron)" }}>
            {(["all", "cover", "describe"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className="px-3 py-1.5 rounded text-xs font-mono font-bold transition-all"
                style={{
                  background: filter === f ? "var(--forge-ember)" : "transparent",
                  color: filter === f ? "var(--forge-black)" : "var(--forge-muted)",
                }}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Count */}
        <p className="text-xs font-mono mb-5" style={{ color: "var(--forge-faint)" }}>
          {loading ? "Loading..." : `${filtered.length} preset${filtered.length !== 1 ? "s" : ""}`}
        </p>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin" style={{ color: "var(--forge-ember)" }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-xl flex items-center justify-center mb-4"
              style={{ background: "var(--forge-iron)", border: "1px solid var(--forge-border)" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--forge-faint)" }}>
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <p className="text-base font-mono mb-2" style={{ color: "var(--forge-muted)" }}>
              {search ? "No presets match your search" : "No presets saved yet"}
            </p>
            <p className="text-sm mb-6" style={{ color: "var(--forge-faint)" }}>
              {search ? "Try a different search term" : "Head to the Forge and build your first one"}
            </p>
            {!search && (
              <Link href="/forge"
                className="px-6 py-3 rounded text-sm font-mono font-bold transition-all"
                style={{ background: "var(--forge-ember)", color: "var(--forge-black)" }}>
                Open the Forge →
              </Link>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((p) => (
              <PresetCard key={p.id} preset={p} onDelete={(id) => setPresets((prev) => prev.filter((x) => x.id !== id))} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
