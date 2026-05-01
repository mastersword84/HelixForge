// ============================================================
// HELIXFORGE — PRESET TEMPLATE APPLIER
// Applies high-level "decisions" from Claude onto a real,
// validated factory preset to produce an importable .hsp.
// Schema fidelity is guaranteed because all the boilerplate
// (device_id, controller blocks, sources, xyctrl, harness, etc.)
// is preserved verbatim from a known-good factory preset.
// ============================================================

import templateJson from "./preset-template.json";
import fxBlockReference from "./fx-block-reference.json";
import catalog from "./helix-catalog.json";

// ── Decisions: what Claude outputs ─────────────────────────
export interface PresetDecisions {
  name: string;
  info?: string;
  amp: BlockDecision;
  cab: BlockDecision;
  /**
   * FX slot decisions. `slot` is one of b01-b05 (pre-amp) or b07-b12 (post-amp).
   * Slots not mentioned will be force-bypassed in every snapshot.
   */
  fx?: FxDecision[];
  snapshots: (SnapshotDecision | null)[];
  /** Cover-mode metadata; passed through to meta but does not affect preset patching. */
  sections?: SectionMeta[];
  /** MIDI tempo for the preset (BPM). Defaults to 120. */
  tempo?: number;
}

export interface BlockDecision {
  model: string;
  params?: Record<string, number | boolean>;
  /**
   * Per-snapshot parameter overrides. Each entry is an 8-element array; null
   * means "inherit the default value" for that snapshot. e.g.
   *   { Drive: [0.3, 0.5, 0.7, null, null, null, null, null] }
   * gives CLEAN drive 0.3, CRUNCH 0.5, LEAD 0.7, snapshots 4-8 use default.
   */
  snapshotParams?: Record<string, (number | boolean | null)[]>;
}

export interface FxDecision {
  slot: string;     // "b01" through "b12"
  model: string;
  params?: Record<string, number | boolean>;
  /** 8-element bypass map. true = active in that snapshot, false = bypassed. */
  snapshotEnabled?: boolean[];
  /** Per-snapshot parameter values (same shape as BlockDecision.snapshotParams). */
  snapshotParams?: Record<string, (number | boolean | null)[]>;
}

export interface SnapshotDecision {
  name: string;
  /** Optional per-snapshot tempo (BPM). null/undefined = inherit preset tempo. */
  tempo?: number | null;
}

export interface SectionMeta {
  name: string;
  snapshotIndex: number;
  approxTimestamp: string;
  toneDescription: string;
  midiCCValue: number;
}

// ── Helpers ────────────────────────────────────────────────

type Json = unknown;
type JsonObj = Record<string, Json>;

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isObject(v: unknown): v is JsonObj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Find which b-key in a path holds a block of the given type.
 * Returns the key like "b06" or null if not found.
 */
function findBlockOfType(path: JsonObj, type: string): string | null {
  for (const key of Object.keys(path)) {
    if (!/^b\d{2}$/.test(key)) continue;
    const block = path[key];
    if (isObject(block) && block.type === type) return key;
  }
  return null;
}

/**
 * Set or replace the @enabled.snapshots array on a block.
 */
function setBlockSnapshotEnabled(block: JsonObj, snapshotEnabled: boolean[]): void {
  const enabled = isObject(block["@enabled"]) ? block["@enabled"] : ((block["@enabled"] = {}) as JsonObj);
  (enabled as JsonObj).snapshots = snapshotEnabled.slice(0, 8);
  // @enabled.value is the "current" state; set it to whatever snapshot 0 is so the preset opens consistent
  (enabled as JsonObj).value = snapshotEnabled[0] ?? false;
}

/**
 * Replace the model + merge params on a block's slot[0].
 * If `replaceParams` is true, the existing slot params are wiped first — required
 * when swapping to a different model since old model's params don't apply to new
 * model. `snapshotParams` adds snapshots: [...] arrays to specified params for
 * per-snapshot value variations (e.g., Drive 0.3 in CLEAN, 0.7 in LEAD).
 */
function patchSlot(
  block: JsonObj,
  model: string,
  params?: Record<string, number | boolean>,
  snapshotParams?: Record<string, (number | boolean | null)[]>,
  replaceParams = false
): void {
  const slot = Array.isArray(block.slot) ? (block.slot as JsonObj[]) : null;
  if (!slot || slot.length === 0) {
    throw new Error("Block has no slot[] to patch");
  }
  slot[0].model = model;

  const target: JsonObj = replaceParams
    ? ((slot[0].params = {}) as JsonObj)
    : (isObject(slot[0].params) ? slot[0].params : ((slot[0].params = {}) as JsonObj));

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      const existing = isObject(target[key]) ? (target[key] as JsonObj) : {};
      target[key] = { ...existing, value };
    }
  }

  if (snapshotParams) {
    for (const [key, snapArr] of Object.entries(snapshotParams)) {
      const padded = snapArr.slice(0, 8);
      while (padded.length < 8) padded.push(null);
      const existing = isObject(target[key]) ? (target[key] as JsonObj) : { value: padded.find((v) => v != null) ?? 0 };
      target[key] = { ...existing, snapshots: padded };
    }
  }
}

/**
 * Construct an FX block at the given position by cloning the reference block
 * and rewriting position-dependent fields. Returns the new block ready to be
 * inserted into the path object.
 */
function buildFxBlock(positionKey: string, pathIndex: 0 | 1): JsonObj {
  const positionNum = parseInt(positionKey.slice(1), 10);
  if (Number.isNaN(positionNum)) throw new Error(`Invalid position key: ${positionKey}`);

  const block = deepClone(fxBlockReference) as JsonObj;
  block.path = pathIndex;
  block.position = positionNum;

  // Footswitch source ID convention: positions 1-12 map to 16843008-16843019.
  // Users can remap in HX Stadium app — we just need a valid default.
  if (isObject(block["@enabled"])) {
    const enabled = block["@enabled"] as JsonObj;
    if (isObject(enabled.controller)) {
      (enabled.controller as JsonObj).source = 16843007 + positionNum;
    }
  }
  return block;
}

// ── Main applier ───────────────────────────────────────────

export interface AppliedPreset {
  meta: JsonObj;
  preset: JsonObj;
}

/**
 * Hard validation: every model ID Claude picked must exist in the
 * mined catalog. If any is unknown, throw — never let an unverified
 * preset reach the user's Stadium (hallucinated IDs caused a boot
 * loop on 2026-04-30; that must not happen again).
 */
export class InvalidModelError extends Error {
  constructor(public invalidModels: Array<{ slot: string; type: string; model: string }>) {
    const lines = invalidModels.map((m) => `  ${m.type} @ ${m.slot}: "${m.model}"`);
    super(`Decisions reference ${invalidModels.length} model ID(s) not in the Stadium catalog. Generation rejected to protect the device:\n${lines.join("\n")}`);
    this.name = "InvalidModelError";
  }
}

const CATALOG_AMPS = new Set(Object.keys(catalog.amps));
const CATALOG_CABS = new Set(Object.keys(catalog.cabs));
const CATALOG_FX = new Set(Object.keys(catalog.fx));

export function validateDecisions(decisions: PresetDecisions): void {
  const invalid: Array<{ slot: string; type: string; model: string }> = [];

  if (!CATALOG_AMPS.has(decisions.amp.model)) {
    invalid.push({ slot: "amp", type: "amp", model: decisions.amp.model });
  }
  if (!CATALOG_CABS.has(decisions.cab.model)) {
    invalid.push({ slot: "cab", type: "cab", model: decisions.cab.model });
  }
  for (const fx of decisions.fx ?? []) {
    if (!CATALOG_FX.has(fx.model)) {
      invalid.push({ slot: fx.slot, type: "fx", model: fx.model });
    }
  }

  if (invalid.length > 0) throw new InvalidModelError(invalid);
}

/**
 * Apply Claude's decisions to the preset template, producing a complete,
 * schema-valid Helix Stadium preset object ready to be wrapped with
 * the "rpshnosj" header.
 */
export function applyDecisions(decisions: PresetDecisions): AppliedPreset {
  // Hard fail before we touch the template if any model ID is unknown.
  // Hallucinated IDs can crash the Stadium firmware on import.
  validateDecisions(decisions);

  const result = deepClone(templateJson) as { meta: JsonObj; preset: JsonObj };

  // ── meta ───────────────────────────────────────────────
  result.meta.name = decisions.name;
  result.meta.info = decisions.info ?? "";
  // device_id / device_version / color stay verbatim from the template

  // ── Path 1 (the working signal chain) ──────────────────
  const flow = result.preset.flow;
  if (!Array.isArray(flow) || flow.length < 1 || !isObject(flow[0])) {
    throw new Error("Template preset.flow is malformed");
  }
  const path1 = flow[0] as JsonObj;

  // Locate amp + cab blocks
  const ampKey = findBlockOfType(path1, "amp");
  const cabKey = findBlockOfType(path1, "cab");
  if (!ampKey || !cabKey) {
    throw new Error(`Template missing amp (${ampKey}) or cab (${cabKey}) block`);
  }
  patchSlot(
    path1[ampKey] as JsonObj,
    decisions.amp.model,
    decisions.amp.params,
    decisions.amp.snapshotParams,
    /*replaceParams*/ true
  );
  patchSlot(
    path1[cabKey] as JsonObj,
    decisions.cab.model,
    decisions.cab.params,
    decisions.cab.snapshotParams,
    /*replaceParams*/ true
  );

  // ── FX blocks ──────────────────────────────────────────
  // Build a map of which FX slots Claude wants to use. Existing template FX
  // blocks not in this map get force-bypassed; requested slots that don't yet
  // exist in the template get constructed from the reference block.
  // Reserved slots (input/amp/cab/output) cannot host FX — drop those silently
  // rather than overwriting structural blocks.
  const reservedSlots = new Set([
    "b00",                                  // input
    ampKey, cabKey,                          // amp + cab
    "b13",                                   // output
  ]);
  const fxMap = new Map<string, FxDecision>();
  for (const fx of decisions.fx ?? []) {
    if (reservedSlots.has(fx.slot)) {
      console.warn(`Dropping FX request at reserved slot ${fx.slot} (model: ${fx.model})`);
      continue;
    }
    fxMap.set(fx.slot, fx);
  }

  // First pass: patch existing FX blocks or bypass them if unused
  for (const key of Object.keys(path1)) {
    if (!/^b\d{2}$/.test(key)) continue;
    const block = path1[key];
    if (!isObject(block)) continue;
    if (block.type !== "fx") continue;

    const wanted = fxMap.get(key);
    if (wanted) {
      patchSlot(block, wanted.model, wanted.params, wanted.snapshotParams, /*replaceParams*/ true);
      setBlockSnapshotEnabled(
        block,
        wanted.snapshotEnabled ?? [true, true, true, true, true, true, true, true]
      );
      fxMap.delete(key); // mark as handled
    } else {
      setBlockSnapshotEnabled(block, [false, false, false, false, false, false, false, false]);
    }
  }

  // Second pass: any FX decisions still in fxMap correspond to slots the
  // template doesn't have yet — construct them from the reference block.
  for (const [slotKey, fx] of fxMap) {
    if (!/^b\d{2}$/.test(slotKey)) {
      throw new Error(`Invalid FX slot key from decisions: ${slotKey}`);
    }
    const newBlock = buildFxBlock(slotKey, 0);
    patchSlot(newBlock, fx.model, fx.params, fx.snapshotParams, /*replaceParams*/ true);
    setBlockSnapshotEnabled(
      newBlock,
      fx.snapshotEnabled ?? [true, true, true, true, true, true, true, true]
    );
    path1[slotKey] = newBlock;
  }

  // ── Snapshots: names and tempo overrides ───────────────
  const snapshots = result.preset.snapshots;
  if (!Array.isArray(snapshots)) {
    throw new Error("Template preset.snapshots is not an array");
  }
  for (let i = 0; i < Math.min(snapshots.length, 8); i++) {
    const decision = decisions.snapshots[i];
    const snap = snapshots[i] as JsonObj;
    if (decision) {
      snap.name = decision.name;
      snap.valid = true;
      if (decision.tempo != null) snap.tempo = decision.tempo;
    }
    // null entries leave the existing snapshot config alone (carries template defaults)
  }

  // ── Preset tempo ───────────────────────────────────────
  if (decisions.tempo != null && isObject(result.preset.params)) {
    const presetParams = result.preset.params as JsonObj;
    const tempoParam = isObject(presetParams.tempo) ? (presetParams.tempo as JsonObj) : null;
    if (tempoParam) tempoParam.value = decisions.tempo;
  }

  return result;
}

/**
 * Wrap an applied preset with the "rpshnosj" magic header to produce
 * the final on-disk format. The frontend already does this when
 * downloading, so server-side this is mostly useful for testing.
 */
export function serializePreset(applied: AppliedPreset): string {
  return "rpshnosj" + JSON.stringify(applied);
}
