import { NextRequest } from "next/server";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Parse a model string ID into a human-readable display name.
// e.g. "Agoura_AmpBritMegaBass" → "Brit Mega Bass"
//      "HD2_DistDarkDoveFuzzStereo" → "Dark Dove Fuzz"
//      "P35_InputInst1" → "Input"
//      "P35_OutputPath2A" → "Output"
//      "VIC_DynPlateStereo" → "Dyn Plate"
function modelStringToName(s: string): string {
  // Strip platform prefix (e.g. "HD2_", "Agoura_", "P35_", "VIC_", "HX2_")
  let name = s.replace(/^[A-Za-z0-9]+_/, "");

  // Shortcut: block types that map to fixed display names
  if (name.startsWith("Input")) return "Input";
  if (name.startsWith("Output")) return "Output";
  if (name.startsWith("Looper")) return "Looper";
  if (name.startsWith("Split")) return "Split";
  if (name.startsWith("Join") || name.startsWith("Merge")) return "Merge";

  // Strip block-category prefixes (order matters — longer matches first).
  // Do NOT include model names here (e.g. "CaliQ", "DynPlate" are model names, not categories).
  const categories = [
    "CabMicIr_", "Compressor", "VolPan",
    "Amp", "Cab", "Dist", "Delay", "Reverb", "Chorus",
    "Tremolo", "Pitch", "Dynamics", "Filter", "Wah",
    "Octave", "Flanger", "Phaser", "Synth", "Ring",
    "Mod", "EQ",
  ];
  let strippedCat = "";
  for (const cat of categories) {
    if (name.startsWith(cat)) {
      strippedCat = cat.replace(/_$/, ""); // save category as fallback (strip trailing _)
      name = name.slice(cat.length);
      break;
    }
  }

  // Strip trailing Stereo/Mono (with optional version suffix like V2)
  name = name.replace(/(Stereo|Mono)(V\d+)?$/, "");

  // Expand known short model names
  if (name === "Vol") name = "Volume";

  // If stripping produced empty string, use the category name itself
  if (!name.trim() && strippedCat) name = strippedCat;

  // Insert spaces before capital letters (CamelCase → words)
  name = name.replace(/([A-Z])/g, " $1").trim();

  // Collapse multiple spaces
  name = name.replace(/\s+/g, " ").trim();

  return name || s;
}

// Extract slot→modelString map from a parsed .hsp flow array.
// Uses only flow[0] (path A) — device sfg_.flow[0].blks uses the same slot numbering.
function extractHspSlots(flow: unknown[]): Map<number, string> {
  const map = new Map<number, string>();
  // Only process path 0 to avoid slot collisions with path 1 blocks.
  const path = flow[0];
  if (!path || typeof path !== "object") return map;
  for (const [key, blkObj] of Object.entries(path as Record<string, unknown>)) {
    if (!key.match(/^b\d+$/) || !blkObj || typeof blkObj !== "object") continue;
    const bk = blkObj as Record<string, unknown>;
    const slotNum = parseInt(key.slice(1), 10); // "b05" → 5
    const slots = bk["slot"] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(slots) && slots.length > 0 && typeof slots[0]?.["model"] === "string") {
      map.set(slotNum, slots[0]["model"] as string);
    }
  }
  return map;
}

const SAMPLES_DIR = join(process.cwd(), "samples");

function loadHspSlots(presetName: string): Map<number, string> | null {
  try {
    // Try exact match, then prefix match (e.g. "Brit MegaGuitar" → "Brit MegaGuitar.hsp")
    const files = readdirSync(SAMPLES_DIR).filter(f => f.endsWith(".hsp"));
    const target = presetName.trim().toLowerCase();
    const match = files.find(f => {
      const n = f.replace(/\.hsp$/i, "").toLowerCase();
      return n === target || n.replace(/[_\s-]+/g, "") === target.replace(/[_\s-]+/g, "");
    });
    if (!match) return null;

    const buf = readFileSync(join(SAMPLES_DIR, match));
    const start = buf.indexOf(0x7b); // find '{'
    if (start < 0) return null;
    const json = JSON.parse(buf.slice(start).toString("utf8")) as { preset?: { flow?: unknown[] } };
    const flow = json?.preset?.flow;
    if (!Array.isArray(flow)) return null;
    return extractHspSlots(flow);
  } catch { return null; }
}

// POST /api/stadium/resolve-models
// Body: { presetName: string; slots: Array<{slot: number; modelId: number}> }
// Returns: { names: Record<number, string> }  — modelId → display name

export async function POST(req: NextRequest) {
  let presetName: string;
  let slots: Array<{ slot: number; modelId: number }>;
  try {
    const body = await req.json() as { presetName?: string; slots?: Array<{ slot: number; modelId: number }> };
    presetName = body.presetName ?? "";
    slots = Array.isArray(body.slots) ? body.slots : [];
  } catch {
    return Response.json({ ok: false, error: "bad JSON" }, { status: 400 });
  }

  const hspSlots = presetName ? loadHspSlots(presetName) : null;
  const names: Record<number, string> = {};

  for (const { slot, modelId } of slots) {
    if (modelId == null) continue;
    const modelStr = hspSlots?.get(slot);
    if (modelStr) {
      names[modelId] = modelStringToName(modelStr);
    }
  }

  return Response.json({ ok: true, names, hspFound: hspSlots !== null });
}
