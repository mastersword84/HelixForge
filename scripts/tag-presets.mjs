#!/usr/bin/env node
// ============================================================
// HELIXFORGE — PRESET LIBRARY TAGGER
// Reads samples/*.hsp and produces lib/preset-library.json:
// a tagged index of every factory preset for use as few-shot
// inspiration when generating new presets.
//
// Tags each preset with style/genre/character based on:
//   - amp model used
//   - FX chain composition
//   - preset name keywords
//   - meta.info description text
//
// Usage: node scripts/tag-presets.mjs
// ============================================================

import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SAMPLES = join(ROOT, "samples");
const OUTPUT = join(ROOT, "lib", "preset-library.json");

const MAGIC = "rpshnosj";

function readPreset(path) {
  const buf = readFileSync(path);
  if (buf.slice(0, MAGIC.length).toString("ascii") !== MAGIC) return null;
  return JSON.parse(buf.slice(MAGIC.length).toString("utf8"));
}

function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

// ── Amp → style mapping ────────────────────────────────────
const AMP_STYLES = [
  // Modern high-gain / metal
  { match: /5150|EVH|Friedman|GermanXtra|EVPanamaRed|RevvCh4|Diezel/i, tags: ["metal", "high-gain", "modern"] },
  { match: /RevvCh3/i, tags: ["modern-rock", "crunch", "high-gain"] },
  { match: /Mesa|Rectifier/i, tags: ["metal", "rock", "scooped"] },
  { match: /EVPanamaBlue/i, tags: ["rock", "high-gain"] },
  // Classic rock / British
  { match: /JCM800|JM800|Brit2203/i, tags: ["rock", "british", "crunch"] },
  { match: /Plexi|JM45/i, tags: ["classic-rock", "british", "vintage"] },
  { match: /Bluesbreaker/i, tags: ["blues", "british", "vintage"] },
  { match: /WhoWatt|HiWatt/i, tags: ["rock", "british", "clean"] },
  { match: /Mandarin/i, tags: ["stoner-rock", "fuzz-friendly", "orange"] },
  // Boutique British / Vox
  { match: /Matchless|Matchstick|MatchH30|MatchG25/i, tags: ["boutique", "british", "chime", "jazz-friendly"] },
  { match: /AC30|AC15|Class30|Class5|EssexTB30|TB30/i, tags: ["british", "chime", "vintage"] },
  // Fender clean
  { match: /Twin|USDouble|USLuxe/i, tags: ["clean", "fender", "country", "blues"] },
  { match: /Deluxe|USDelu/i, tags: ["clean", "fender", "blues"] },
  { match: /Princess|Princeton|USPrinc/i, tags: ["clean", "fender", "small-amp", "blues"] },
  { match: /Tweed|US5WTweed|SmallTweed/i, tags: ["vintage", "fender", "tweed", "blues"] },
  { match: /SoloLead/i, tags: ["clean", "studio"] },
  { match: /JazzRivet/i, tags: ["jazz", "clean"] },
  // Bass
  { match: /BAS_|Ampeg|SVT|Agua|MegaBass|DripBass|RegalBass|ZeroAmpBass|B15/i, tags: ["bass"] },
  // Other / fallback
  { match: /Solid100/i, tags: ["clean", "neutral"] },
  { match: /WoodyBlue/i, tags: ["acoustic-friendly"] },
  { match: /BusyOne/i, tags: ["fuzz", "vintage"] },
  { match: /DerailedIngrid/i, tags: ["high-gain", "rock"] },
  { match: /USSuperVib/i, tags: ["clean", "fender", "vibrato"] },
  { match: /Badonk/i, tags: ["funk", "country", "clean"] },
  { match: /Clarity|VintagePre/i, tags: ["studio", "clean"] },
];

// ── FX → flavor tags ───────────────────────────────────────
const FX_FLAVORS = [
  { match: /Fuzz/i, tag: "fuzz" },
  { match: /Shimmer/i, tag: "ambient" },
  { match: /Particle|Searchlights|DynBloom|Cosmos/i, tag: "ambient" },
  { match: /63Spring|HxSpring/i, tag: "spring-reverb" },
  { match: /Hall|Plate/i, tag: "lush-reverb" },
  { match: /Rotary|145Rotary/i, tag: "leslie" },
  { match: /Chorus/i, tag: "chorus" },
  { match: /Phaser/i, tag: "phaser" },
  { match: /Tremolo/i, tag: "tremolo" },
  { match: /Flanger/i, tag: "flanger" },
  { match: /Vibrato/i, tag: "vibrato" },
  { match: /TapeEcho|Transistor|BucketBrigade|ElephantMan/i, tag: "tape-delay" },
  { match: /SimpleDelay|VintageDigital|Adriatic|PingPong/i, tag: "delay" },
  { match: /Reverse/i, tag: "reverse" },
  { match: /Wah/i, tag: "wah" },
  { match: /Pitch|Octav/i, tag: "pitch-shift" },
  { match: /Synth|SynthOMatic/i, tag: "synth" },
  { match: /Compress|Squeeze|Comp/i, tag: "compression" },
  { match: /Screamer|Scream808|TS808/i, tag: "tubescreamer" },
  { match: /Klon|Minotaur/i, tag: "klon" },
  { match: /BigMuff|Muff/i, tag: "muff-fuzz" },
  { match: /Rat/i, tag: "rat-distortion" },
];

// ── Name → style hints ─────────────────────────────────────
const NAME_HINTS = [
  { match: /Nash|Country|Twang|Tele/i, tags: ["country"] },
  { match: /Plexi|Brit|UK|British/i, tags: ["british", "classic-rock"] },
  { match: /Metal|Djent|Doom|German|Revv|Knife|Pesc/i, tags: ["metal"] },
  { match: /Jazz/i, tags: ["jazz"] },
  { match: /Bass|BAS_|Bottom|Pick-King|Slap/i, tags: ["bass"] },
  { match: /Dream|Ambient|Pink|Reflection|Bell|Smell|Space|Prism|Bliss|Reflection/i, tags: ["ambient"] },
  { match: /Fuzz|Mandarin|Orange|Purple/i, tags: ["fuzz"] },
  { match: /Funk/i, tags: ["funk"] },
  { match: /Blue Dive|Slow Dano|Blues/i, tags: ["blues"] },
  { match: /Studio|Direct|Clean/i, tags: ["clean", "studio"] },
  { match: /Lead|Solo/i, tags: ["lead"] },
  { match: /Stadium|Rock/i, tags: ["rock"] },
];

function extractAmpsFromFlow(flow) {
  if (!Array.isArray(flow)) return [];
  const amps = [];
  for (const path of flow) {
    if (!isObj(path)) continue;
    for (const [k, block] of Object.entries(path)) {
      if (!/^b\d{2}$/.test(k) || !isObj(block)) continue;
      if (block.type !== "amp" || !Array.isArray(block.slot)) continue;
      const m = block.slot[0]?.model;
      if (typeof m === "string") amps.push(m);
    }
  }
  return amps;
}

function extractCabsFromFlow(flow) {
  if (!Array.isArray(flow)) return [];
  const cabs = [];
  for (const path of flow) {
    if (!isObj(path)) continue;
    for (const [k, block] of Object.entries(path)) {
      if (!/^b\d{2}$/.test(k) || !isObj(block)) continue;
      if (block.type !== "cab" || !Array.isArray(block.slot)) continue;
      const m = block.slot[0]?.model;
      if (typeof m === "string") cabs.push(m);
    }
  }
  return cabs;
}

function extractFxFromFlow(flow) {
  if (!Array.isArray(flow)) return [];
  const fx = [];
  for (const path of flow) {
    if (!isObj(path)) continue;
    for (const [k, block] of Object.entries(path)) {
      if (!/^b\d{2}$/.test(k) || !isObj(block)) continue;
      if (block.type !== "fx" || !Array.isArray(block.slot)) continue;
      const m = block.slot[0]?.model;
      if (typeof m === "string") fx.push(m);
    }
  }
  return fx;
}

function tagPreset(name, info, amps, fx) {
  const tags = new Set();

  for (const amp of amps) {
    for (const rule of AMP_STYLES) {
      if (rule.match.test(amp)) rule.tags.forEach((t) => tags.add(t));
    }
  }

  for (const f of fx) {
    for (const rule of FX_FLAVORS) {
      if (rule.match.test(f)) tags.add(rule.tag);
    }
  }

  // Only match against the preset NAME — info text contains marketing prose
  // ("great clean tone for studio") that triggers false positives.
  for (const rule of NAME_HINTS) {
    if (rule.match.test(name)) {
      rule.tags.forEach((t) => tags.add(t));
    }
  }

  return [...tags].sort();
}

function main() {
  const files = readdirSync(SAMPLES).filter((f) => f.endsWith(".hsp"));
  const library = [];
  const skipped = [];

  for (const f of files) {
    try {
      const preset = readPreset(join(SAMPLES, f));
      if (!preset) { skipped.push({ file: f, reason: "no rpshnosj header" }); continue; }
      const amps = extractAmpsFromFlow(preset?.preset?.flow);
      const cabs = extractCabsFromFlow(preset?.preset?.flow);
      const fx = extractFxFromFlow(preset?.preset?.flow);
      const tags = tagPreset(preset?.meta?.name ?? f, preset?.meta?.info ?? "", amps, fx);

      library.push({
        file: f,
        name: preset?.meta?.name ?? f.replace(/\.hsp$/, ""),
        info: preset?.meta?.info ?? "",
        amps,
        cabs,
        fx,
        fxCount: fx.length,
        tags,
      });
    } catch (err) {
      skipped.push({ file: f, reason: err.message });
    }
  }

  // Skip files with no tags AND no recognizable amp — likely empty templates / our generated test outputs
  const filtered = library.filter((p) => p.tags.length > 0 || p.amps.length > 0);

  const summary = {
    generatedAt: new Date().toISOString(),
    presetCount: filtered.length,
    presets: filtered.sort((a, b) => a.name.localeCompare(b.name)),
  };

  writeFileSync(OUTPUT, JSON.stringify(summary, null, 2));
  console.log(`Wrote ${OUTPUT}`);
  console.log(`Tagged: ${filtered.length} / ${files.length} files`);

  // Show tag distribution
  const tagCounts = {};
  for (const p of filtered) for (const t of p.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
  console.log("\nTag distribution:");
  Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => {
    console.log(`  ${t.padEnd(20)} ${n}`);
  });

  if (skipped.length) {
    console.log("\nSkipped:");
    for (const s of skipped) console.log(`  - ${s.file}: ${s.reason}`);
  }
}

main();
