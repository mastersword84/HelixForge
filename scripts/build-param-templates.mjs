#!/usr/bin/env node
// ============================================================
// HELIXFORGE — MODEL BLOCK TEMPLATE BUILDER
// For each unique amp/cab/FX model in the corpus, captures the
// COMPLETE block structure (not just slot params) from a real
// factory preset. Stadium silently strips blocks whose harness,
// slot[], or surrounding fields don't match the model schema.
//
// Captures everything EXCEPT coordinate-specific fields
// (path, position, linkedblock) which the applier rewrites for
// the destination slot.
//
// Usage: node scripts/build-param-templates.mjs
// ============================================================

import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SAMPLES = join(ROOT, "samples");
const OUTPUT = join(ROOT, "lib", "model-param-templates.json");

const MAGIC = "rpshnosj";

function readPreset(path) {
  const buf = readFileSync(path);
  if (buf.subarray(0, MAGIC.length).toString("ascii") !== MAGIC) return null;
  return JSON.parse(buf.subarray(MAGIC.length).toString("utf8"));
}

function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

// Strip coordinate-specific fields so the block template is
// position-agnostic. These get written when we apply to a slot.
const COORD_FIELDS = ["path", "position", "linkedblock", "endpoint"];

function templateFromBlock(block) {
  const tpl = {};
  for (const [k, v] of Object.entries(block)) {
    if (COORD_FIELDS.includes(k)) continue;
    tpl[k] = JSON.parse(JSON.stringify(v));
  }
  return tpl;
}

function walkBlocks(preset, fn) {
  const flow = preset?.preset?.flow;
  if (!Array.isArray(flow)) return;
  for (const path of flow) {
    if (!isObj(path)) continue;
    for (const [key, blk] of Object.entries(path)) {
      if (!/^b\d{2}$/.test(key)) continue;
      if (!isObj(blk)) continue;
      const slot = blk.slot;
      if (!Array.isArray(slot) || slot.length === 0) continue;
      const s = slot[0];
      if (!isObj(s) || typeof s.model !== "string") continue;
      fn({ blockKey: key, type: blk.type, model: s.model, block: blk });
    }
  }
}

function main() {
  const files = readdirSync(SAMPLES).filter((f) => f.endsWith(".hsp"));
  const templates = {}; // modelId -> { type, blockTemplate, source }

  for (const f of files) {
    try {
      const preset = readPreset(join(SAMPLES, f));
      if (!preset) continue;
      walkBlocks(preset, (b) => {
        if (templates[b.model]) return;
        templates[b.model] = {
          type: b.type,
          blockTemplate: templateFromBlock(b.block),
          source: f,
        };
      });
    } catch (err) {
      console.warn(`  skip ${f}: ${err.message}`);
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    modelCount: Object.keys(templates).length,
    templates,
  };

  writeFileSync(OUTPUT, JSON.stringify(summary, null, 2));
  console.log(`Wrote ${OUTPUT}`);
  console.log(`Captured FULL block templates for ${summary.modelCount} unique models.`);
}

main();
