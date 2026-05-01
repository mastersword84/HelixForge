#!/usr/bin/env node
// ============================================================
// HELIXFORGE — PRESET CORPUS MINER
// Scans samples/*.hsp, extracts every unique model ID and the
// parameter names + observed value ranges per model. Produces
// lib/helix-catalog.json — the source of truth for what models
// exist in this Helix Stadium firmware.
//
// Usage:  node scripts/mine-presets.mjs
// ============================================================

import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SAMPLES = join(ROOT, "samples");
const OUTPUT = join(ROOT, "lib", "helix-catalog.json");

const MAGIC = "rpshnosj";

function readPresetJson(path) {
  const buf = readFileSync(path);
  if (buf.slice(0, MAGIC.length).toString("ascii") !== MAGIC) {
    throw new Error(`File ${path} missing rpshnosj header`);
  }
  return JSON.parse(buf.slice(MAGIC.length).toString("utf8"));
}

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Catalog accumulator.
 * Per model:
 *   - sampleCount: how many presets used this model
 *   - params: { paramName: { observedValues: Set<value>, type: "number"|"boolean"|"string" } }
 */
function makeCatalog() {
  return {
    inputs: {},
    outputs: {},
    amps: {},
    cabs: {},
    fx: {},
    splits: {},
    joins: {},
    other: {},
  };
}

function bucketForType(type) {
  switch (type) {
    case "input":   return "inputs";
    case "output":  return "outputs";
    case "amp":     return "amps";
    case "cab":     return "cabs";
    case "fx":      return "fx";
    case "split":   return "splits";
    case "join":    return "joins";
    default:        return "other";
  }
}

function recordModel(catalog, type, model, params) {
  const bucket = catalog[bucketForType(type)];
  if (!bucket[model]) {
    bucket[model] = { sampleCount: 0, params: {} };
  }
  bucket[model].sampleCount += 1;

  if (!isObj(params)) return;
  for (const [name, val] of Object.entries(params)) {
    if (!isObj(val)) continue;
    const value = val.value;
    if (value === undefined) continue;

    const slot = bucket[model].params[name] ??= {
      type: typeof value,
      observed: new Set(),
    };
    slot.observed.add(JSON.stringify(value));
  }
}

function visitFlow(flow, catalog) {
  if (!Array.isArray(flow)) return;
  for (const path of flow) {
    if (!isObj(path)) continue;
    for (const [key, block] of Object.entries(path)) {
      if (!/^b\d{2}$/.test(key)) continue;
      if (!isObj(block)) continue;
      const type = block.type;
      const slot = block.slot;
      if (!type || !Array.isArray(slot) || slot.length === 0) continue;
      for (const s of slot) {
        if (!isObj(s) || typeof s.model !== "string") continue;
        recordModel(catalog, type, s.model, s.params);
      }
    }
  }
}

function summarizeBucket(bucket) {
  const out = {};
  for (const [model, data] of Object.entries(bucket)) {
    const params = {};
    for (const [name, slot] of Object.entries(data.params)) {
      const vals = [...slot.observed].map((s) => JSON.parse(s));
      const numeric = vals.every((v) => typeof v === "number");
      params[name] = numeric
        ? { type: "number", min: Math.min(...vals), max: Math.max(...vals), samples: vals.length }
        : { type: slot.type, examples: vals.slice(0, 5) };
    }
    out[model] = { sampleCount: data.sampleCount, params };
  }
  return out;
}

function main() {
  const files = readdirSync(SAMPLES).filter((f) => f.endsWith(".hsp"));
  if (files.length === 0) {
    console.error("No .hsp files in samples/. Drop some factory presets there first.");
    process.exit(1);
  }

  const catalog = makeCatalog();
  const skipped = [];

  for (const f of files) {
    try {
      const preset = readPresetJson(join(SAMPLES, f));
      visitFlow(preset?.preset?.flow, catalog);
      console.log(`  + ${f}`);
    } catch (err) {
      skipped.push({ file: f, reason: err.message });
    }
  }

  if (skipped.length) {
    console.log("\nSkipped:");
    for (const s of skipped) console.log(`  - ${s.file}: ${s.reason}`);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    sourceFiles: files,
    inputs:  summarizeBucket(catalog.inputs),
    outputs: summarizeBucket(catalog.outputs),
    amps:    summarizeBucket(catalog.amps),
    cabs:    summarizeBucket(catalog.cabs),
    fx:      summarizeBucket(catalog.fx),
    splits:  summarizeBucket(catalog.splits),
    joins:   summarizeBucket(catalog.joins),
    other:   summarizeBucket(catalog.other),
  };

  const counts = {
    inputs:  Object.keys(summary.inputs).length,
    outputs: Object.keys(summary.outputs).length,
    amps:    Object.keys(summary.amps).length,
    cabs:    Object.keys(summary.cabs).length,
    fx:      Object.keys(summary.fx).length,
    splits:  Object.keys(summary.splits).length,
    joins:   Object.keys(summary.joins).length,
    other:   Object.keys(summary.other).length,
  };

  writeFileSync(OUTPUT, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${OUTPUT}`);
  console.log("Catalog:", counts);
}

main();
