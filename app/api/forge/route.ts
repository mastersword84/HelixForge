import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { HELIX_SYSTEM_PROMPT } from "@/lib/helix-knowledge";
import { lookupSong, buildSectionSummaryForForge } from "@/lib/song-lookup";
import { applyDecisionsToBase, SimpleDecisions, SectionMeta } from "@/lib/preset-template";
import { selectBasePreset, describeBaseBlocks, BasePresetSelection } from "@/lib/base-preset";

const client = new Anthropic();

// ── Prompts ────────────────────────────────────────────────────

function buildDescribePrompt(
  description: string,
  presetName: string,
  baseDescription: string
) {
  return `Generate a Helix Stadium preset for this tone request. The server has
already chosen a known-good factory preset as the BASE — your job is only to
tweak its existing blocks (param values, snapshot bypass states, snapshot
names). You CANNOT swap any models, add blocks, or change the chain.

${baseDescription}

TONE REQUEST: "${description}"
PRESET NAME: "${presetName}"

Return a single JSON object with this EXACT shape:
{
  "decisions": {
    "name": "short preset name (use the user's preset name above)",
    "info": "1-3 sentence description of how this base was tuned for this tone",
    "blockParams": {
      "p0:b06": { "Drive": 0.4, "Bass": 0.5, "Mid": 0.6, "Treble": 0.7, "Master": 0.55 }
    },
    "blockSnapshotParams": {
      "p0:b06": { "Drive": [0.30, 0.45, 0.65, null, null, null, null, null] }
    },
    "blockSnapshotEnabled": {
      "p0:b01": [true, true, true, false, false, false, false, false],
      "p0:b07": [false, false, true, false, false, false, false, false]
    },
    "snapshots": [
      { "name": "CLEAN" }, { "name": "CRUNCH" }, { "name": "LEAD" },
      null, null, null, null, null
    ],
    "tempo": 120
  },
  "uiMeta": {
    "description": "${description}",
    "chain": ["..." /* readable block names from the base, in order */]
  }
}

CRITICAL RULES:
- ALL block keys MUST be path-aware: "p0:b01" or "p1:b06" — NEVER bare "b01".
  The path prefix tells the server which path's block to modify; bare keys
  are silently dropped (server cannot disambiguate).
- ONLY reference (path, slot) coordinates listed in the BASE BLOCK LAYOUT.
- DO NOT touch blocks on a path that isn't carrying the main signal — those
  may be doing routing/volume/split duties and modifying them breaks the
  audio chain (and crashes the device on import).
- For "blockParams" and "blockSnapshotParams", only set param names that
  exist on that block (Drive, Bass, Mid, Treble, Master, Mix, Time, etc.).
  Server drops unknown params silently.
- "blockSnapshotEnabled" arrays MUST be exactly 8 booleans.
- Snapshot array is exactly 8 entries. Use null for unused slots.
- Output ONLY the JSON — no markdown fences, no prose.`;
}

function buildCoverSongPrompt(
  songTitle: string,
  artist: string,
  notes: string,
  baseDescription: string,
  structureContext?: string
) {
  const contextBlock = structureContext
    ? `\n${structureContext}\n\nUse the section data above directly — your "sections" array timestamps must come from this lookup data, not invented timestamps.\n`
    : `\nNo audio/section data was provided. Use your knowledge of the song to estimate section timestamps.\n`;

  return `You are building a Helix Stadium preset for a guitarist performing
"${songTitle}" by ${artist} as a live cover. The server already chose a
known-good factory preset as the BASE — your job is only to tweak its
existing blocks. You CANNOT swap models, add blocks, or change the chain.

${baseDescription}
${notes ? `\nGuitarist notes: "${notes}"` : ""}
${contextBlock}
SNAPSHOT CONSOLIDATION RULES:
- 8 snapshot slots; use NO MORE THAN 6.
- Verses with same tone share ONE "VERSE" snapshot.
- CHORUS always separate from VERSE.
- SOLO always its own snapshot.
- Typical minimum: VERSE, CHORUS, SOLO.

Return a single JSON object with this EXACT shape:
{
  "decisions": {
    "name": "${songTitle} — ${artist}",
    "info": "2-3 sentences on tone approach and snapshot consolidation",
    "blockParams": { "p0:b06": { "Drive": 0.35, "Bass": 0.5, "Mid": 0.6, "Treble": 0.7 } },
    "blockSnapshotParams": {
      "p0:b06": { "Drive": [0.30, 0.45, 0.55, null, null, null, null, null] }
    },
    "blockSnapshotEnabled": {
      "p0:b01": [false, true, true, false, false, false, false, false],
      "p0:b07": [false, false, true, false, false, false, false, false]
    },
    "snapshots": [
      { "name": "VERSE" }, { "name": "CHORUS" }, { "name": "SOLO" },
      null, null, null, null, null
    ],
    "tempo": 120
  },
  "uiMeta": {
    "description": "...",
    "chain": ["..." /* base preset's block names, readable */],
    "sections": [
      { "name": "INTRO", "snapshotIndex": 0, "approxTimestamp": "0:00", "toneDescription": "Clean intro", "midiCCValue": 0 },
      { "name": "VERSE 1", "snapshotIndex": 0, "approxTimestamp": "0:07", "toneDescription": "Verse tone", "midiCCValue": 0 },
      { "name": "CHORUS 1", "snapshotIndex": 1, "approxTimestamp": "0:29", "toneDescription": "Chorus push", "midiCCValue": 1 }
    ],
    "midiInfo": {
      "cc": 69,
      "channel": 1,
      "note": "Program CC69 at each timestamp in your DAW. Set Helix to MIDI channel 1."
    }
  }
}

CRITICAL RULES:
- ALL block keys MUST be path-aware: "p0:b01" or "p1:b06" — NEVER bare "b01".
- ONLY reference (path, slot) coordinates listed in the BASE BLOCK LAYOUT.
- DO NOT touch blocks on a path that isn't carrying the main signal.
- snapshotIndex / midiCCValue must match the snapshots array order.
- Output ONLY the JSON — no markdown, no prose.`;
}

// ── Route ──────────────────────────────────────────────────────

interface ClaudeResponse {
  decisions: SimpleDecisions;
  uiMeta: {
    description: string;
    chain: string[];
    sections?: SectionMeta[];
    midiInfo?: { cc: number; channel: number; note: string };
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { mode, description, presetName, songTitle, artist, notes, audioAnalysis } = body;
    const presetSlot = (body.presetSlot as string | undefined)?.trim() || "";
    const setlistBank = (body.setlistBank as string | undefined)?.trim() || "1";

    // ── SAFE MIDI-ONLY MODE ──
    // For when the user wants only MIDI automation for their show and will
    // pick a factory preset manually on the device. Skips ALL preset
    // generation — zero risk of bricking the Stadium.
    if (body.midiOnly === true) {
      if (!songTitle?.trim() || !artist?.trim()) {
        return NextResponse.json({ error: "Song title and artist are required for MIDI-only mode" }, { status: 400 });
      }
      try {
        const lookup = await lookupSong({ title: songTitle.trim(), artist: artist.trim() });
        if (!lookup.found) {
          return NextResponse.json({ error: "Song not found in lookup. Try a different spelling.", warnings: lookup.warnings }, { status: 404 });
        }

        // Map detected sections to the frontend MIDI exporter shape.
        // De-dupe section names that share a tone (all VERSEs share snap 0).
        // Clamp out any sections whose start time exceeds the actual song
        // duration — Claude occasionally hallucinates trailing timestamps.
        const songDuration = lookup.spotify?.durationSec ?? Infinity;
        const nameToSnap = new Map<string, number>();
        const baseSections = lookup.sections
          .filter((s) => s.startSec < songDuration)
          .map((s) => {
            const baseName = s.name.replace(/\s*\d+$/, "").toUpperCase();
            if (!nameToSnap.has(baseName)) nameToSnap.set(baseName, nameToSnap.size);
            return {
              name: s.name,
              snapshotIndex: nameToSnap.get(baseName)!,
              approxTimestamp: s.startTime,
              toneDescription: `${baseName} section`,
              midiCCValue: nameToSnap.get(baseName)!,
            };
          });

        const responseMeta = {
          name: `${songTitle} — ${artist}`,
          description: `MIDI automation for "${lookup.spotify?.title}" by ${lookup.spotify?.artist}. Pick a factory preset on Stadium that matches this song's vibe; the MIDI track will switch its snapshots in time.`,
          chain: ["MIDI Automation Only — load any factory preset on Stadium"],
          snapshots: [...nameToSnap.keys()].slice(0, 8).concat(Array(Math.max(0, 8 - nameToSnap.size)).fill(null)),
          sections: baseSections,
          midiInfo: {
            cc: 69,
            channel: 1,
            note: "Program CC69 at each timestamp in your DAW. Set Helix to MIDI channel 1. Snapshot index = CC value.",
            presetSlot: presetSlot || undefined,
            setlistBank: presetSlot ? setlistBank : undefined,
          },
          midiOnly: true,
          duration: lookup.spotify?.durationSec,
        };

        // Return null hsp so the frontend hides the preset download button.
        return NextResponse.json({ meta: responseMeta, hsp: null });
      } catch (err) {
        console.error("MIDI-only lookup failed:", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Lookup failed" }, { status: 500 });
      }
    }

    // ── REGULAR (full preset generation) MODE ──
    // Pick the factory base preset based on the request
    let basePreset: BasePresetSelection | null = null;
    let userPrompt: string;

    if (mode === "cover") {
      if (!songTitle?.trim() || !artist?.trim()) {
        return NextResponse.json({ error: "Song title and artist are required" }, { status: 400 });
      }

      const query = `${songTitle} ${artist} ${notes ?? ""}`;
      basePreset = selectBasePreset(query);
      if (!basePreset) {
        return NextResponse.json({ error: "Could not load a base factory preset." }, { status: 500 });
      }

      let structureContext = audioAnalysis as string | undefined;
      if (!structureContext) {
        try {
          const lookup = await lookupSong({ title: songTitle.trim(), artist: artist.trim() });
          if (lookup.found) structureContext = buildSectionSummaryForForge(lookup);
        } catch (err) {
          console.error("Song lookup failed:", err);
        }
      }

      userPrompt = buildCoverSongPrompt(
        songTitle.trim(),
        artist.trim(),
        notes?.trim() || "",
        describeBaseBlocks(basePreset),
        structureContext
      );
    } else {
      if (!description?.trim()) {
        return NextResponse.json({ error: "Description is required" }, { status: 400 });
      }

      basePreset = selectBasePreset(description);
      if (!basePreset) {
        return NextResponse.json({ error: "Could not load a base factory preset." }, { status: 500 });
      }

      userPrompt = buildDescribePrompt(
        description.trim(),
        presetName?.trim() || "HelixForge Preset",
        describeBaseBlocks(basePreset)
      );
    }

    const message = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 8192,
      system: HELIX_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "";

    let parsed: ClaudeResponse;
    try {
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse AI response.", raw },
        { status: 500 }
      );
    }

    if (!parsed?.decisions || !parsed?.uiMeta) {
      return NextResponse.json(
        { error: "Incomplete AI response — missing decisions or uiMeta.", raw },
        { status: 500 }
      );
    }

    let appliedPreset;
    try {
      appliedPreset = applyDecisionsToBase(basePreset.hsp, parsed.decisions);
    } catch (err) {
      console.error("Apply failed:", err);
      return NextResponse.json(
        { error: `Could not apply decisions: ${err instanceof Error ? err.message : "unknown"}` },
        { status: 500 }
      );
    }

    const responseMeta = {
      name: parsed.decisions.name,
      description: parsed.uiMeta.description,
      chain: parsed.uiMeta.chain,
      snapshots: parsed.decisions.snapshots.map((s) => s?.name ?? null),
      sections: parsed.uiMeta.sections ?? null,
      midiInfo: parsed.uiMeta.midiInfo
        ? {
            ...parsed.uiMeta.midiInfo,
            presetSlot: presetSlot || undefined,
            setlistBank: presetSlot ? setlistBank : undefined,
          }
        : null,
      basePreset: { filename: basePreset.filename, name: basePreset.name },
    };

    return NextResponse.json({ meta: responseMeta, hsp: appliedPreset });
  } catch (error) {
    console.error("Forge error:", error);
    return NextResponse.json({ error: "Generation failed. Check your API key." }, { status: 500 });
  }
}
