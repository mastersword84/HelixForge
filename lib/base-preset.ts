// ============================================================
// HELIXFORGE — FACTORY BASE PRESET LOADER
// Picks the most relevant factory preset for a given request and
// loads its full .hsp content. The applier uses this preset's
// complete block structure as the base — guaranteed to import
// because Stadium itself made it.
// ============================================================

import { readFileSync } from "fs";
import { join } from "path";
import { findRelevantPresets, inferQueryTags } from "./preset-library";

const MAGIC = "rpshnosj";

interface ParsedPreset {
  meta: Record<string, unknown>;
  preset: Record<string, unknown>;
}

export interface BasePresetSelection {
  filename: string;
  name: string;
  tags: string[];
  matchedTags: string[];
  amps: string[];
  cabs: string[];
  fx: string[];
  hsp: ParsedPreset;
}

function loadPresetByFile(filename: string): ParsedPreset | null {
  try {
    const buf = readFileSync(join(process.cwd(), "samples", filename));
    if (buf.subarray(0, MAGIC.length).toString("ascii") !== MAGIC) return null;
    const obj = JSON.parse(buf.subarray(MAGIC.length).toString("utf8")) as ParsedPreset;
    return obj;
  } catch {
    return null;
  }
}

/**
 * Pick the best-matching factory preset for the query. Falls back to
 * a known-good general-purpose preset (Nashville) if no good match.
 */
export function selectBasePreset(query: string): BasePresetSelection | null {
  const tags = inferQueryTags(query);
  const ranked = findRelevantPresets(tags, /*limit*/ 3, /*minScore*/ 1);

  // Walk top matches in order, return first that loads cleanly
  for (const r of ranked) {
    const hsp = loadPresetByFile(r.file);
    if (hsp && hasUsableSignalChain(hsp)) {
      return { filename: r.file, name: r.name, tags: r.tags, matchedTags: r.matchedTags, amps: r.amps, cabs: r.cabs, fx: r.fx, hsp };
    }
  }

  // Fallback: walk all library presets and return the first single-path one
  // (amp+cab on Path 0). Nashville-style parallel-amp presets are excluded
  // by hasUsableSignalChain.
  const library = require("./preset-library.json") as { presets: Array<{ file: string; name: string; tags: string[]; amps: string[]; cabs: string[]; fx: string[] }> };
  for (const p of library.presets) {
    const hsp = loadPresetByFile(p.file);
    if (hsp && hasUsableSignalChain(hsp)) {
      return {
        filename: p.file,
        name: p.name,
        tags: p.tags,
        matchedTags: [],
        amps: p.amps,
        cabs: p.cabs,
        fx: p.fx,
        hsp,
      };
    }
  }

  return null;
}

function hasUsableSignalChain(p: ParsedPreset): boolean {
  const flow = (p.preset as { flow?: unknown }).flow;
  if (!Array.isArray(flow) || flow.length === 0) return false;

  // Path 0 must have amp + cab (the signal chain we modify).
  const path0 = flow[0];
  if (!path0 || typeof path0 !== "object") return false;
  let p0HasAmp = false;
  let p0HasCab = false;
  for (const [key, blk] of Object.entries(path0)) {
    if (!/^b\d{2}$/.test(key) || !blk || typeof blk !== "object") continue;
    const t = (blk as { type?: string }).type;
    if (t === "amp") p0HasAmp = true;
    if (t === "cab") p0HasCab = true;
  }
  if (!(p0HasAmp && p0HasCab)) return false;

  // Path 1 (if it exists) must NOT also carry a signal chain. Parallel-rig
  // presets like "2 Guitar Rig" or Nashville have a second amp+cab on Path 1
  // — modifying Path 1 in those breaks the second chain and bricks Stadium.
  // Path 1 with only input/output/passthrough blocks is fine (most presets).
  if (flow.length > 1 && flow[1] && typeof flow[1] === "object") {
    for (const [key, blk] of Object.entries(flow[1])) {
      if (!/^b\d{2}$/.test(key) || !blk || typeof blk !== "object") continue;
      const t = (blk as { type?: string }).type;
      // Reject if Path 1 has amp, cab, or any FX block (signal-carrying).
      if (t === "amp" || t === "cab" || t === "fx") return false;
    }
  }

  return true;
}

/**
 * Build a compact human-readable summary of a base preset's block layout
 * for inclusion in Claude's prompt. Tells Claude which slot positions
 * already have what kind of block, so it can plan snapshot bypass states
 * and per-block param tweaks.
 */
export function describeBaseBlocks(base: BasePresetSelection): string {
  const lines: string[] = [];
  lines.push(`BASE PRESET: "${base.name}" (${base.filename})`);
  if (base.tags.length > 0) lines.push(`Tags: ${base.tags.join(", ")}`);
  lines.push("");
  lines.push(`BLOCK LAYOUT — every block has a PATH-AWARE KEY like "p0:b06" or "p1:b06".`);
  lines.push(`Both paths can have a block at the same b-position; the path prefix is REQUIRED`);
  lines.push(`when you reference a block in blockParams / blockSnapshotEnabled / blockSnapshotParams.`);
  lines.push("");

  const flow = base.hsp.preset.flow as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(flow)) return lines.join("\n");

  for (let pi = 0; pi < flow.length; pi++) {
    const path = flow[pi];
    if (!path || typeof path !== "object") continue;
    const pathBlocks: string[] = [];
    for (const [key, blk] of Object.entries(path)) {
      if (!/^b\d{2}$/.test(key)) continue;
      if (!blk || typeof blk !== "object") continue;
      const b = blk as { type?: string; slot?: Array<{ model?: string }> };
      if (!b.type) continue;
      const model = Array.isArray(b.slot) && b.slot[0]?.model ? b.slot[0].model : "(empty)";
      pathBlocks.push(`  p${pi}:${key}  type=${b.type.padEnd(6)} model=${model}`);
    }
    if (pathBlocks.length > 0) {
      lines.push(`Path ${pi + 1} (use prefix "p${pi}:" when referring to its blocks):`);
      lines.push(...pathBlocks);
    }
  }
  lines.push("");
  lines.push(`The amp/cab in this preset are at the positions shown above. Tweak THOSE specific`);
  lines.push(`blocks for tone shaping. NEVER touch blocks on the unused path or in unused`);
  lines.push(`positions — that disrupts the audio routing.`);
  return lines.join("\n");
}
