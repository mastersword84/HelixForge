// ============================================================
// HELIXFORGE — TAGGED PRESET LIBRARY (FEW-SHOT SOURCE)
// Loads the auto-tagged preset-library.json, supports ranked
// search by tag overlap, and synthesizes a compact "reference
// summary" string that can be injected into Claude's prompt
// as inspiration for similar-style tones.
// ============================================================

import { readFileSync } from "fs";
import { join } from "path";
import libraryJson from "./preset-library.json";

interface LibraryEntry {
  file: string;
  name: string;
  info: string;
  amps: string[];
  cabs: string[];
  fx: string[];
  fxCount: number;
  tags: string[];
}

interface LibrarySummary {
  generatedAt: string;
  presetCount: number;
  presets: LibraryEntry[];
}

const library = libraryJson as LibrarySummary;

// ── Tag inference from a free-text query ───────────────────
// Maps user words/phrases to library tags. Order matters — earlier
// matches don't preempt later ones (we collect all matches).
const QUERY_TAGS: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /\b(metal|djent|doom|brutal|breakdown|chug)\b/i,            tag: "metal" },
  { pattern: /\b(high.?gain|hi.?gain|saturated|extreme)\b/i,              tag: "high-gain" },
  { pattern: /\b(modern|tight|polished)\b/i,                              tag: "modern" },
  { pattern: /\b(classic.?rock|seventies|70s)\b/i,                        tag: "classic-rock" },
  { pattern: /\b(british|marshall|plexi|jcm|jtm|2203)\b/i,                tag: "british" },
  { pattern: /\b(crunch|crunchy|breakup|edge.?of)\b/i,                    tag: "crunch" },
  { pattern: /\b(fender|twin|deluxe|princeton|princess|tweed|champ)\b/i,  tag: "fender" },
  { pattern: /\b(clean|sparkle|chime|chimey|glassy)\b/i,                  tag: "clean" },
  { pattern: /\b(country|nashville|twang|tele|chicken.?pickin)\b/i,       tag: "country" },
  { pattern: /\b(blues|bluesy|srv|texas)\b/i,                             tag: "blues" },
  { pattern: /\b(jazz|jazzy)\b/i,                                         tag: "jazz" },
  { pattern: /\b(funk|funky|wakka)\b/i,                                   tag: "funk" },
  { pattern: /\b(ambient|atmospheric|swell|shimmer|ethereal|cinematic)\b/i, tag: "ambient" },
  { pattern: /\b(fuzz|fuzzy|stoner)\b/i,                                  tag: "fuzz" },
  { pattern: /\b(orange|stoner)\b/i,                                      tag: "orange" },
  { pattern: /\b(boutique|matchless|matchstick|dumble)\b/i,               tag: "boutique" },
  { pattern: /\b(vox|ac30|ac15|top.?boost)\b/i,                           tag: "chime" },
  { pattern: /\b(vintage|retro|sixties|60s)\b/i,                          tag: "vintage" },
  { pattern: /\b(bass|bassist|low.?end)\b/i,                              tag: "bass" },
  { pattern: /\b(spring.?reverb|surf|surfy)\b/i,                          tag: "spring-reverb" },
  { pattern: /\b(hall|plate|cathedral|huge.?reverb)\b/i,                  tag: "lush-reverb" },
  { pattern: /\b(slap.?back|slap)\b/i,                                    tag: "tape-delay" },
  { pattern: /\b(tape.?delay|echoplex|tape.?echo)\b/i,                    tag: "tape-delay" },
  { pattern: /\b(tubescreamer|ts.?808|ts9|screamer)\b/i,                  tag: "tubescreamer" },
  { pattern: /\b(klon|centaur|minotaur)\b/i,                              tag: "klon" },
  { pattern: /\b(rat)\b/i,                                                tag: "rat-distortion" },
  { pattern: /\b(rotary|leslie)\b/i,                                      tag: "leslie" },
  { pattern: /\b(chorus|chorused)\b/i,                                    tag: "chorus" },
  { pattern: /\b(phaser|phased)\b/i,                                      tag: "phaser" },
  { pattern: /\b(tremolo|trem)\b/i,                                       tag: "tremolo" },
  { pattern: /\b(wah)\b/i,                                                tag: "wah" },
  { pattern: /\b(pitch|octav|harmoniz|whammy)\b/i,                        tag: "pitch-shift" },
];

export function inferQueryTags(query: string): string[] {
  const tags = new Set<string>();
  for (const { pattern, tag } of QUERY_TAGS) {
    if (pattern.test(query)) tags.add(tag);
  }
  return [...tags];
}

// ── Ranked search ──────────────────────────────────────────
export interface RankedPreset extends LibraryEntry {
  score: number;
  matchedTags: string[];
}

/**
 * Rank library presets by how many of the query tags they cover.
 * Returns top-N matches above the score threshold (defaults exclude
 * 0-overlap matches, since they'd be misleading examples).
 */
export function findRelevantPresets(
  queryOrTags: string | string[],
  limit = 2,
  minScore = 1
): RankedPreset[] {
  const queryTags = Array.isArray(queryOrTags) ? queryOrTags : inferQueryTags(queryOrTags);
  if (queryTags.length === 0) return [];

  const ranked: RankedPreset[] = library.presets.map((p) => {
    const matched = p.tags.filter((t) => queryTags.includes(t));
    return { ...p, score: matched.length, matchedTags: matched };
  });

  return ranked
    .filter((p) => p.score >= minScore)
    .sort((a, b) => b.score - a.score || a.fxCount - b.fxCount)
    .slice(0, limit);
}

// ── Load full preset on demand for few-shot summary ────────

interface BlockSummary {
  slot: string;
  type: string;
  model: string;
  params: Record<string, unknown>;
}

function readPresetSnapshot(file: string): { meta: Record<string, unknown>; blocks: BlockSummary[] } | null {
  try {
    const buf = readFileSync(join(process.cwd(), "samples", file));
    if (buf.subarray(0, 8).toString("ascii") !== "rpshnosj") return null;
    const obj = JSON.parse(buf.subarray(8).toString("utf8"));
    const flow = obj?.preset?.flow;
    const blocks: BlockSummary[] = [];
    if (Array.isArray(flow)) {
      for (const path of flow) {
        if (path == null || typeof path !== "object") continue;
        for (const [key, blk] of Object.entries(path)) {
          if (!/^b\d{2}$/.test(key)) continue;
          if (blk == null || typeof blk !== "object") continue;
          const b = blk as { type?: string; slot?: Array<{ model?: string; params?: Record<string, unknown> }> };
          if (!b.type || !Array.isArray(b.slot) || b.slot.length === 0) continue;
          const s = b.slot[0];
          if (typeof s.model !== "string") continue;
          blocks.push({ slot: key, type: b.type, model: s.model, params: s.params ?? {} });
        }
      }
    }
    return { meta: obj?.meta ?? {}, blocks };
  } catch {
    return null;
  }
}

const KEY_AMP_PARAMS = ["Drive", "Bass", "Mid", "Treble", "Master", "Presence", "Sag", "Channel", "Bright"];
const KEY_CAB_PARAMS = ["Mic", "LowCut", "HighCut", "Distance", "Position", "Level"];
const KEY_FX_PARAMS_LIMIT = 6;

function summarizeParams(params: Record<string, unknown>, keys: string[] | "auto", limit?: number): string {
  const entries: string[] = [];
  const keysArr = keys === "auto" ? Object.keys(params).slice(0, limit ?? KEY_FX_PARAMS_LIMIT) : keys;
  for (const k of keysArr) {
    const v = params[k];
    if (v == null) continue;
    const value = (v as { value?: unknown }).value;
    if (value == null) continue;
    if (typeof value === "number") {
      entries.push(`${k}=${Number(value.toFixed(3))}`);
    } else {
      entries.push(`${k}=${value}`);
    }
  }
  return entries.join(", ");
}

/**
 * Build a compact human-readable summary of one preset for use as a few-shot
 * reference in Claude's prompt. Caps at ~600 chars per preset.
 */
export function buildReferenceSummary(entry: LibraryEntry): string | null {
  const data = readPresetSnapshot(entry.file);
  if (!data) return null;

  const ampBlock = data.blocks.find((b) => b.type === "amp");
  const cabBlock = data.blocks.find((b) => b.type === "cab");
  const fxBlocks = data.blocks.filter((b) => b.type === "fx");

  const lines: string[] = [];
  lines.push(`REFERENCE: "${entry.name}" — tags: [${entry.tags.join(", ")}]`);
  if (entry.info) lines.push(`Info: ${entry.info.split("\n")[0].slice(0, 200)}`);

  if (ampBlock) {
    lines.push(`AMP @ ${ampBlock.slot}: ${ampBlock.model}`);
    const ampParams = summarizeParams(ampBlock.params, KEY_AMP_PARAMS);
    if (ampParams) lines.push(`  ${ampParams}`);
  }
  if (cabBlock) {
    lines.push(`CAB @ ${cabBlock.slot}: ${cabBlock.model}`);
    const cabParams = summarizeParams(cabBlock.params, KEY_CAB_PARAMS);
    if (cabParams) lines.push(`  ${cabParams}`);
  }
  if (fxBlocks.length > 0) {
    lines.push(`FX:`);
    for (const fx of fxBlocks.slice(0, 8)) {
      const params = summarizeParams(fx.params, "auto");
      lines.push(`  ${fx.slot}: ${fx.model}${params ? `  (${params})` : ""}`);
    }
  }

  return lines.join("\n");
}

/**
 * High-level helper: given a free-text user description, return the few-shot
 * context string to inject into Claude's prompt (or null if no good matches).
 */
export function buildFewShotContext(query: string, maxPresets = 2): string | null {
  const matches = findRelevantPresets(query, maxPresets);
  if (matches.length === 0) return null;

  const summaries = matches
    .map((m) => buildReferenceSummary(m))
    .filter((s): s is string => s !== null);

  if (summaries.length === 0) return null;

  const header = `STADIUM REFERENCE PRESETS (use these as inspiration — match their tonal approach, mic choices, and parameter ranges for similar tones; you don't need to copy exactly):`;
  return header + "\n\n" + summaries.join("\n\n");
}
