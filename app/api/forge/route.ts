import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { HELIX_SYSTEM_PROMPT } from "@/lib/helix-knowledge";
import { lookupSong, buildSectionSummaryForForge } from "@/lib/song-lookup";
import { applyDecisions, PresetDecisions, SectionMeta } from "@/lib/preset-template";
import { buildFewShotContext } from "@/lib/preset-library";

const client = new Anthropic();

// ── Prompts ────────────────────────────────────────────────────

function buildDescribePrompt(description: string, presetName: string, fewShot?: string) {
  const fewShotBlock = fewShot ? `\n${fewShot}\n` : "";
  return `Generate a Helix Stadium preset for this tone request.
${fewShotBlock}
TONE: "${description}"
PRESET NAME: "${presetName}"

Return a single JSON object with this EXACT shape:
{
  "decisions": {
    "name": "short preset name",
    "info": "1-3 sentence description of the tone",
    "amp": { "model": "...", "params": {...} },
    "cab": { "model": "...", "params": {...} },
    "fx": [
      { "slot": "b01", "model": "...", "params": {...}, "snapshotEnabled": [bool x 8] },
      { "slot": "b02", "model": "...", "params": {...}, "snapshotEnabled": [bool x 8] },
      { "slot": "b07", "model": "...", "params": {...}, "snapshotEnabled": [bool x 8] }
    ],
    "snapshots": [
      { "name": "CLEAN" }, { "name": "CRUNCH" }, { "name": "LEAD" },
      null, null, null, null, null
    ],
    "tempo": 120
  },
  "uiMeta": {
    "description": "${description}",
    "chain": ["Input", "LA Comp", "TS Drive", "Twin Reverb", "4x10 Tweed", "Spring Reverb", "Output"]
  }
}

The "chain" is human-readable block names in signal-chain order for UI display.
Return ONLY the JSON — no markdown, no prose.`;
}

function buildCoverSongPrompt(
  songTitle: string,
  artist: string,
  notes: string,
  structureContext?: string,
  fewShot?: string
) {
  const contextBlock = structureContext
    ? `\n${structureContext}\n\nUse the section data above directly — match your "sections" array timestamps to those boundaries. Calibrate snapshot drive/EQ/effects to the measured tonal character per section.\n`
    : `\nNo audio data was provided. Use your knowledge of the song to estimate section timestamps and tones.\n`;
  const fewShotBlock = fewShot ? `\n${fewShot}\n` : "";

  return `You are building a Helix Stadium preset for a guitarist performing "${songTitle}" by ${artist} as a live cover.
${notes ? `\nGuitarist notes: "${notes}"` : ""}
${fewShotBlock}${contextBlock}
SNAPSHOT CONSOLIDATION RULES — strict:
- 8 snapshot slots; use NO MORE THAN 6. Leave at least 2 null.
- Only create a new snapshot when the guitar TONE actually changes.
- Verses with the same tone share ONE "VERSE" snapshot. MIDI map points multiple timestamps at the same CC value.
- Do NOT create VERSE 1 / VERSE 2 etc. unless they're tonally distinct.

REQUIRED SEPARATE SNAPSHOTS:
- CHORUS always separate from VERSE (more presence, drive, or brighter EQ).
- SOLO always its own snapshot.
- INTRO may share with VERSE only if identical tone.
- BRIDGE separate if tonally different.
- Typical minimum: VERSE, CHORUS, SOLO.

Return a single JSON object with this EXACT shape:
{
  "decisions": {
    "name": "${songTitle} — ${artist}",
    "info": "2-3 sentence description of the tone approach and snapshot consolidation",
    "amp": { "model": "...", "params": {...} },
    "cab": { "model": "...", "params": {...} },
    "fx": [
      { "slot": "b01", "model": "...", "params": {...}, "snapshotEnabled": [bool x 8] }
    ],
    "snapshots": [
      { "name": "VERSE" }, { "name": "CHORUS" }, { "name": "SOLO" },
      null, null, null, null, null
    ],
    "tempo": 120
  },
  "uiMeta": {
    "description": "...",
    "chain": ["Input", "...", "Output"],
    "sections": [
      {
        "name": "INTRO",
        "snapshotIndex": 0,
        "approxTimestamp": "0:00",
        "toneDescription": "Clean Tele intro",
        "midiCCValue": 0
      },
      {
        "name": "VERSE 1",
        "snapshotIndex": 0,
        "approxTimestamp": "0:07",
        "toneDescription": "Same as VERSE snapshot",
        "midiCCValue": 0
      },
      {
        "name": "CHORUS 1",
        "snapshotIndex": 1,
        "approxTimestamp": "0:29",
        "toneDescription": "Pushed mids, brighter",
        "midiCCValue": 1
      }
    ],
    "midiInfo": {
      "cc": 69,
      "channel": 1,
      "note": "Program CC69 at each timestamp in your DAW. Set Helix to MIDI channel 1."
    }
  }
}

snapshotIndex/midiCCValue MUST match the position of the snapshot in the snapshots array (0-indexed).
Return ONLY the JSON — no markdown, no commentary.`;
}

// ── Route ──────────────────────────────────────────────────────

interface ClaudeResponse {
  decisions: PresetDecisions;
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

    let userPrompt: string;

    if (mode === "cover") {
      if (!songTitle?.trim() || !artist?.trim()) {
        return NextResponse.json({ error: "Song title and artist are required" }, { status: 400 });
      }

      let structureContext = audioAnalysis as string | undefined;
      if (!structureContext) {
        try {
          const lookup = await lookupSong({ title: songTitle.trim(), artist: artist.trim() });
          if (lookup.found) structureContext = buildSectionSummaryForForge(lookup);
        } catch (err) {
          console.error("Song lookup failed, falling back to general knowledge:", err);
        }
      }

      const coverQuery = `${songTitle} ${artist} ${notes ?? ""}`;
      const fewShot = buildFewShotContext(coverQuery, 2);
      userPrompt = buildCoverSongPrompt(
        songTitle.trim(),
        artist.trim(),
        notes?.trim() || "",
        structureContext,
        fewShot ?? undefined
      );
    } else {
      if (!description?.trim()) {
        return NextResponse.json({ error: "Description is required" }, { status: 400 });
      }
      const fewShot = buildFewShotContext(description, 2);
      userPrompt = buildDescribePrompt(
        description.trim(),
        presetName?.trim() || "HelixForge Preset",
        fewShot ?? undefined
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
        { error: "Failed to parse AI response. Try again.", raw },
        { status: 500 }
      );
    }

    if (!parsed.decisions || !parsed.uiMeta) {
      return NextResponse.json(
        { error: "Incomplete AI response — missing decisions or uiMeta.", raw },
        { status: 500 }
      );
    }

    let appliedPreset;
    try {
      appliedPreset = applyDecisions(parsed.decisions);
    } catch (err) {
      console.error("Template application failed:", err);
      return NextResponse.json(
        { error: `Could not apply decisions to template: ${err instanceof Error ? err.message : "unknown error"}` },
        { status: 500 }
      );
    }

    // Build the response shape the existing frontend expects:
    //   meta = catalog/UI metadata (chain pills, snapshot names, sections list)
    //   hsp  = the actual file content { meta: {...with device_id...}, preset: {...} }
    const responseMeta = {
      name: parsed.decisions.name,
      description: parsed.uiMeta.description,
      chain: parsed.uiMeta.chain,
      snapshots: parsed.decisions.snapshots.map((s) => s?.name ?? null),
      sections: parsed.uiMeta.sections ?? null,
      midiInfo: parsed.uiMeta.midiInfo ?? null,
    };

    return NextResponse.json({ meta: responseMeta, hsp: appliedPreset });
  } catch (error) {
    console.error("Forge error:", error);
    return NextResponse.json({ error: "Generation failed. Check your API key." }, { status: 500 });
  }
}
