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
import paramTemplatesJson from "./model-param-templates.json";

interface ModelTemplate {
  type: string;
  blockTemplate: Record<string, unknown>;
  source: string;
}
const MODEL_TEMPLATES: Record<string, ModelTemplate> =
  (paramTemplatesJson as { templates: Record<string, ModelTemplate> }).templates;

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
 * Replace a block's contents with the full known-good template for the new
 * model (harness, slot, @enabled structure, version, etc.) — preserving the
 * destination's coordinate fields (path, position, linkedblock).
 *
 * Stadium silently strips/rejects blocks whose surrounding structure doesn't
 * match the model schema (different harness fields per block type, Trails on
 * delays/reverbs, slot[1] only on certain cabs, etc.). Using a complete
 * factory template means every field Stadium expects for the model is present.
 */
const COORD_FIELDS = ["path", "position", "linkedblock", "endpoint"] as const;

function replaceBlockContentsFromTemplate(block: JsonObj, model: string): JsonObj | null {
  const tpl = MODEL_TEMPLATES[model];
  if (!tpl) return null;

  // Preserve coordinate-specific fields from the destination block.
  const preserved: Record<string, unknown> = {};
  for (const k of COORD_FIELDS) {
    if (k in block) preserved[k] = block[k];
  }

  // Wipe everything except coords, then merge the model template on top.
  for (const k of Object.keys(block)) {
    if (!COORD_FIELDS.includes(k as typeof COORD_FIELDS[number])) {
      delete block[k];
    }
  }
  const fresh = deepClone(tpl.blockTemplate) as JsonObj;
  for (const [k, v] of Object.entries(fresh)) {
    block[k] = v;
  }
  for (const [k, v] of Object.entries(preserved)) {
    block[k] = v;
  }

  // Normalize harness.params to a minimal known-good set for the block type.
  // The captured templates can include harness.params fields (ControlSource,
  // controller mappings, etc.) that reference the SOURCE preset's footswitch
  // wiring. Carrying those over makes Stadium strip the block. Per block type:
  //   amp:   EvtIdx, bypass, upper
  //   cab:   no harness.params
  //   delay: EvtIdx, bypass, upper, Trails
  //   reverb: EvtIdx, bypass, upper, Trails
  //   fx (drive/comp/etc): EvtIdx, bypass, upper
  normalizeHarness(block, tpl.type, model);

  return block;
}

const HARNESS_KEEP_BY_TYPE: Record<string, string[]> = {
  amp:    ["EvtIdx", "bypass", "upper"],
  cab:    [], // no harness.params for cabs
  fx:     ["EvtIdx", "bypass", "upper"], // default; delay/reverb get Trails added below
  input:  ["EvtIdx"],
  output: ["EvtIdx"],
};

const DELAY_PATTERNS = [/Delay/i, /Echo/i];
const REVERB_PATTERNS = [/Reverb/i];

function normalizeHarness(block: JsonObj, blockType: string, model: string): void {
  const harness = isObject(block.harness) ? (block.harness as JsonObj) : null;
  if (!harness) return;
  const params = isObject(harness.params) ? (harness.params as JsonObj) : null;
  if (!params) return;

  const keepBase = HARNESS_KEEP_BY_TYPE[blockType] ?? ["EvtIdx", "bypass", "upper"];
  const keep = new Set(keepBase);
  if (blockType === "fx") {
    if (DELAY_PATTERNS.some((p) => p.test(model)) || REVERB_PATTERNS.some((p) => p.test(model))) {
      keep.add("Trails");
    }
  }

  // Drop anything outside the keep-set; ensure each kept field has at least a default.
  const defaults: Record<string, unknown> = {
    EvtIdx: { value: -1 },
    bypass: { value: false },
    upper:  { value: true },
    Trails: { value: false },
  };
  for (const k of Object.keys(params)) {
    if (!keep.has(k)) delete params[k];
  }
  for (const k of keep) {
    if (!(k in params) && k in defaults) {
      params[k] = defaults[k];
    }
  }

  if (blockType === "cab") {
    // Cabs have no harness.params at all
    delete (harness as JsonObj).params;
  }
}

/**
 * Replace the model on a block and overlay Claude's user-facing param tweaks
 * onto the model's known-good factory template.
 */
function patchSlot(
  block: JsonObj,
  model: string,
  params?: Record<string, number | boolean>,
  snapshotParams?: Record<string, (number | boolean | null)[]>,
  replaceFromTemplate = false
): void {
  if (replaceFromTemplate) {
    const result = replaceBlockContentsFromTemplate(block, model);
    if (!result) {
      // Unknown model — leave existing structure but at least update slot[0].model
      const slot = Array.isArray(block.slot) ? (block.slot as JsonObj[]) : null;
      if (slot && slot.length > 0) slot[0].model = model;
    }
  } else {
    // No replace: just update model in slot[0] (kept for legacy callers)
    const slot = Array.isArray(block.slot) ? (block.slot as JsonObj[]) : null;
    if (slot && slot.length > 0) slot[0].model = model;
  }

  // Now overlay the user-facing param tweaks onto slot[0].params.
  const slot = Array.isArray(block.slot) ? (block.slot as JsonObj[]) : null;
  if (!slot || slot.length === 0) return;
  const target = isObject(slot[0].params) ? (slot[0].params as JsonObj) : ((slot[0].params = {}) as JsonObj);
  const tplParams = MODEL_TEMPLATES[model]?.blockTemplate
    ? ((MODEL_TEMPLATES[model].blockTemplate as JsonObj).slot as JsonObj[])?.[0]?.params
    : null;
  const knownKeys = isObject(tplParams) ? new Set(Object.keys(tplParams)) : null;

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      // Drop params Claude invented that aren't in the model's schema.
      if (knownKeys && !knownKeys.has(key)) continue;
      const existing = isObject(target[key]) ? (target[key] as JsonObj) : {};
      target[key] = { ...existing, value };
    }
  }

  if (snapshotParams) {
    for (const [key, snapArr] of Object.entries(snapshotParams)) {
      if (knownKeys && !knownKeys.has(key)) continue;
      const padded = snapArr.slice(0, 8);
      while (padded.length < 8) padded.push(null);
      const existing = isObject(target[key]) ? (target[key] as JsonObj) : { value: padded.find((v) => v != null) ?? 0 };
      target[key] = { ...existing, snapshots: padded };
    }
  }
}

/**
 * Construct an FX block at the given position. Starts from the FX reference
 * block (provides the harness/controller scaffolding), then sets coord fields.
 * The actual model + its full block schema gets applied after via patchSlot
 * with replaceFromTemplate=true.
 */
function buildFxBlock(positionKey: string, pathIndex: 0 | 1): JsonObj {
  const positionNum = parseInt(positionKey.slice(1), 10);
  if (Number.isNaN(positionNum)) throw new Error(`Invalid position key: ${positionKey}`);

  const block = deepClone(fxBlockReference) as JsonObj;
  block.path = pathIndex;
  block.position = positionNum;

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

// ── SAFE MODE: factory preset + param/snapshot tweaks only ────────
// This is the post-incident architecture. We pick a known-good factory
// preset as the base and only modify safe fields: name, info, slot[0].
// params, snapshot bypass states, snapshot names. Never swap models,
// never construct new blocks. Result: cannot brick the device.

export interface SimpleDecisions {
  name: string;
  info?: string;
  /** Per-block param overrides keyed by slot (b00-b13). Only existing params get touched. */
  blockParams?: Record<string, Record<string, number | boolean>>;
  /** Per-block per-snapshot param values (8-array per param). */
  blockSnapshotParams?: Record<string, Record<string, (number | boolean | null)[]>>;
  /** Per-block 8-element bypass map (true = active in that snapshot). */
  blockSnapshotEnabled?: Record<string, boolean[]>;
  /** Snapshot names (8 entries; null = unused). */
  snapshots: (SnapshotDecision | null)[];
  /** Cover-mode metadata. */
  sections?: SectionMeta[];
  tempo?: number;
}

function applyParamsToExistingSlot(
  block: JsonObj,
  params?: Record<string, number | boolean>,
  snapshotParams?: Record<string, (number | boolean | null)[]>
): void {
  const slot = Array.isArray(block.slot) ? (block.slot as JsonObj[]) : null;
  if (!slot || slot.length === 0) return;
  const target = isObject(slot[0].params) ? (slot[0].params as JsonObj) : null;
  if (!target) return;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      // Only nudge params that already exist for this model (in the factory
      // preset's slot). Prevents Claude from injecting unknown param names.
      if (!(k in target)) continue;
      const existing = isObject(target[k]) ? (target[k] as JsonObj) : {};
      target[k] = { ...existing, value: v };
    }
  }
  if (snapshotParams) {
    for (const [k, arr] of Object.entries(snapshotParams)) {
      if (!(k in target)) continue;
      const padded = arr.slice(0, 8);
      while (padded.length < 8) padded.push(null);
      const existing = isObject(target[k]) ? (target[k] as JsonObj) : { value: padded.find((v) => v != null) ?? 0 };
      target[k] = { ...existing, snapshots: padded };
    }
  }
}

/**
 * Apply Claude's safe decisions to a chosen factory preset. The base preset
 * is preserved structurally — we only modify name, info, slot[0].params on
 * existing blocks, snapshot bypass states, and snapshot names. No model
 * swaps, no new blocks. Stadium WILL accept this because the structure is
 * byte-for-byte from a real factory preset.
 *
 * Decision block keys are PATH-AWARE: "p0:b01" addresses Path 1's b01,
 * "p1:b06" addresses Path 2's b06. Both paths can have a block at the same
 * b-position; treating them as the same key disrupted Path 2's routing on
 * parallel-amp presets like Nashville and bricked the Stadium device.
 */
function parseBlockKey(key: string): { path: number; block: string } | null {
  // "p0:b01" → { path: 0, block: "b01" }; "b01" → null (legacy/ambiguous, reject)
  const m = key.match(/^p(\d+):(b\d{2})$/);
  if (!m) return null;
  return { path: parseInt(m[1], 10), block: m[2] };
}

export function applyDecisionsToBase(
  basePreset: { meta: JsonObj; preset: JsonObj },
  decisions: SimpleDecisions
): AppliedPreset {
  const result = deepClone(basePreset);

  result.meta.name = decisions.name;
  result.meta.info = decisions.info ?? "";

  const flow = result.preset.flow as JsonObj[] | undefined;
  if (Array.isArray(flow)) {
    const flowArr: JsonObj[] = flow;
    function applyToBlock(
      pathIdx: number,
      blockKey: string,
      params?: Record<string, number | boolean>,
      snapParams?: Record<string, (number | boolean | null)[]>,
      enabled?: boolean[]
    ) {
      const path = flowArr[pathIdx];
      if (!isObject(path)) return;
      const blk = (path as JsonObj)[blockKey];
      if (!isObject(blk)) return;
      const block = blk as JsonObj;
      if (params || snapParams) applyParamsToExistingSlot(block, params, snapParams);
      if (enabled) setBlockSnapshotEnabled(block, enabled);
    }

    // Aggregate decisions by parsed (path, block) coordinate
    const collected = new Map<string, {
      pathIdx: number;
      blockKey: string;
      params?: Record<string, number | boolean>;
      snapParams?: Record<string, (number | boolean | null)[]>;
      enabled?: boolean[];
    }>();

    for (const [key, params] of Object.entries(decisions.blockParams ?? {})) {
      const parsed = parseBlockKey(key);
      if (!parsed) { console.warn(`Ignoring ambiguous block key in blockParams: ${key}`); continue; }
      const id = `${parsed.path}:${parsed.block}`;
      const e = collected.get(id) ?? { pathIdx: parsed.path, blockKey: parsed.block };
      e.params = params;
      collected.set(id, e);
    }
    for (const [key, snapParams] of Object.entries(decisions.blockSnapshotParams ?? {})) {
      const parsed = parseBlockKey(key);
      if (!parsed) { console.warn(`Ignoring ambiguous block key in blockSnapshotParams: ${key}`); continue; }
      const id = `${parsed.path}:${parsed.block}`;
      const e = collected.get(id) ?? { pathIdx: parsed.path, blockKey: parsed.block };
      e.snapParams = snapParams;
      collected.set(id, e);
    }
    for (const [key, enabled] of Object.entries(decisions.blockSnapshotEnabled ?? {})) {
      const parsed = parseBlockKey(key);
      if (!parsed) { console.warn(`Ignoring ambiguous block key in blockSnapshotEnabled: ${key}`); continue; }
      const id = `${parsed.path}:${parsed.block}`;
      const e = collected.get(id) ?? { pathIdx: parsed.path, blockKey: parsed.block };
      e.enabled = enabled;
      collected.set(id, e);
    }

    for (const e of collected.values()) {
      applyToBlock(e.pathIdx, e.blockKey, e.params, e.snapParams, e.enabled);
    }
  }

  const snapshots = result.preset.snapshots;
  if (Array.isArray(snapshots)) {
    for (let i = 0; i < Math.min(snapshots.length, 8); i++) {
      const decision = decisions.snapshots[i];
      const snap = snapshots[i] as JsonObj;
      if (decision) {
        snap.name = decision.name;
        snap.valid = true;
        if (decision.tempo != null) snap.tempo = decision.tempo;
      } else {
        snap.name = `SNAPSHOT ${i + 1}`;
        snap.valid = false;
      }
    }
  }

  if (decisions.tempo != null && isObject(result.preset.params)) {
    const presetParams = result.preset.params as JsonObj;
    const tempoParam = isObject(presetParams.tempo) ? (presetParams.tempo as JsonObj) : null;
    if (tempoParam) tempoParam.value = decisions.tempo;
  }

  return result;
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

  // Cabs sometimes come with a slot[1] (NoCab placeholder for dual-cab setups).
  // Single-cab presets must have exactly one slot or Stadium rejects.
  const cabBlock = path1[cabKey] as JsonObj;
  if (Array.isArray(cabBlock.slot) && cabBlock.slot.length > 1) {
    cabBlock.slot = (cabBlock.slot as JsonObj[]).slice(0, 1);
  }

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
    } else {
      // null entries: clear the template's leftover name so on-stage display
      // doesn't show stale labels like "Rhythm Mod" from the source preset.
      snap.name = `SNAPSHOT ${i + 1}`;
      snap.valid = false;
    }
  }

  // ── Preset tempo ───────────────────────────────────────
  if (decisions.tempo != null && isObject(result.preset.params)) {
    const presetParams = result.preset.params as JsonObj;
    const tempoParam = isObject(presetParams.tempo) ? (presetParams.tempo as JsonObj) : null;
    if (tempoParam) tempoParam.value = decisions.tempo;
  }

  // ── Final cleanup ──────────────────────────────────────
  // Strip preset.clip.start (template artifact Stadium ignores)
  if (isObject(result.preset.clip)) {
    delete (result.preset.clip as JsonObj).start;
  }

  // Note: preset.sources is left INTACT from the template. Earlier we tried
  // stripping unused source IDs but Stadium needs the full set of footswitch
  // and snapshot-source registrations even when not used by any specific
  // block — they're the device-wide source registry.

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
