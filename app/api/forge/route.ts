import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { HELIX_SYSTEM_PROMPT } from "@/lib/helix-knowledge";

const client = new Anthropic();

function buildDescribePrompt(description: string, presetName: string) {
  return `Generate a complete Helix preset for this tone request:

TONE: "${description}"
PRESET NAME: "${presetName}"

Return a single JSON object with this exact structure:
{
  "meta": {
    "name": "The preset name",
    "description": "2-3 sentences describing the tone and how it was built",
    "chain": ["Block 1 label", "Block 2 label", "..."],
    "snapshots": ["CLEAN", "CRUNCH", "LEAD", "RHYTHM", "AMBIENT", "BOOST", "HEAVY", "CUSTOM"],
    "sections": null,
    "midiInfo": null
  },
  "hsp": { ...the complete valid Helix preset JSON object... }
}

The "chain" array lists human-readable block names in signal order.
Return ONLY the JSON — no markdown, no explanation.`;
}

function buildCoverSongPrompt(
  songTitle: string,
  artist: string,
  notes: string,
  audioAnalysis?: string
) {
  const audioBlock = audioAnalysis
    ? `\n${audioAnalysis}\n\nThe timestamps above are REAL measured section boundaries from the actual audio file. Use them directly as the "approxTimestamp" values in the sections array. Your snapshot tone settings (amp drive, EQ, effects) must reflect the measured drive level and frequency balance — don't override this with generic assumptions.\n`
    : `\nNo audio file was uploaded. Use your knowledge of the song to estimate section timestamps and appropriate tones.\n`;

  return `You are building a Helix preset for a guitarist performing "${songTitle}" by ${artist} as a live cover.
${notes ? `\nGuitarist notes: "${notes}"` : ""}
${audioBlock}
SNAPSHOT CONSOLIDATION RULES — follow these strictly:
- A Helix preset has 8 snapshot slots. Use NO MORE THAN 6. Leave at least 2 empty (null) for the guitarist to assign manually later.
- Only create a new snapshot when the guitar TONE actually changes — not just because a new section starts.
- If Verse 1, Verse 2, and Verse 3 all use the same clean tone, they share ONE snapshot called VERSE. The MIDI map will point all three timestamps at the same CC69 value.
- Do NOT create VERSE 1, VERSE 2, VERSE 3 etc. unless those verses are genuinely different tones.
- The "sections" array in meta lists every song section with its timestamp and which snapshot it maps to — multiple sections can share the same snapshotIndex and midiCCValue.

REQUIRED SEPARATE SNAPSHOTS — these must ALWAYS be their own snapshot, never collapsed:
- CHORUS must always be separate from VERSE. Even if energy is similar, the chorus in country/rock/pop always has more presence, drive, or a brighter EQ than the verse. Create a CHORUS snapshot.
- SOLO must always be its own snapshot — more drive, lead boost, different delay/reverb.
- INTRO may share with VERSE only if the intro is the same riff played the same way with identical tone.
- BRIDGE must be separate if it exists and differs tonally from verse/chorus.
- Typical minimum layout: VERSE · CHORUS · SOLO (3 snapshots). Add INTRO and OUTRO only if tonally distinct.

Your task:
1. Identify all structural sections of the song. Group sections that share the same tone into one snapshot.
2. ${audioAnalysis ? "Use the measured audio data above to determine when tones actually differ between sections." : "Use your knowledge of the original recording to determine which sections share a tone."}
3. Build ONE Helix preset with consolidated snapshots. Empty snapshot slots (beyond what you use) should be omitted from the hsp.
4. Provide MIDI timestamps for every section occurrence — multiple sections can trigger the same CC69 value.

Return a single JSON object:
{
  "meta": {
    "name": "${songTitle} — ${artist}",
    "description": "2-3 sentences on the tone approach and how snapshots are consolidated",
    "chain": ["Block 1", "Block 2", "..."],
    "snapshots": ["INTRO", "VERSE", "CHORUS", "SOLO", null, null, null, null],
    "sections": [
      {
        "name": "INTRO",
        "snapshotIndex": 0,
        "approxTimestamp": "0:00",
        "toneDescription": "Clean arpeggios, light spring reverb",
        "midiCCValue": 0
      },
      {
        "name": "VERSE 1",
        "snapshotIndex": 1,
        "approxTimestamp": "0:22",
        "toneDescription": "Edge of breakup, Telecaster snap",
        "midiCCValue": 1
      },
      {
        "name": "CHORUS 1",
        "snapshotIndex": 2,
        "approxTimestamp": "1:05",
        "toneDescription": "Full crunch, Screamer pushed",
        "midiCCValue": 2
      },
      {
        "name": "VERSE 2",
        "snapshotIndex": 1,
        "approxTimestamp": "1:45",
        "toneDescription": "Same as Verse 1 — same snapshot",
        "midiCCValue": 1
      }
    ],
    "midiInfo": {
      "cc": 69,
      "channel": 1,
      "note": "Program CC69 at each timestamp in your DAW. Repeated sections reuse the same CC value. Set Helix to the same MIDI channel."
    }
  },
  "hsp": { ...complete Helix preset JSON with only the used snapshots populated... }
}

Snapshot names in "hsp" must match the unique snapshot names exactly. Null slots are left empty.
Return ONLY the JSON — no markdown, no explanation.`;
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
      userPrompt = buildCoverSongPrompt(
        songTitle.trim(),
        artist.trim(),
        notes?.trim() || "",
        audioAnalysis || undefined
      );
    } else {
      if (!description?.trim()) {
        return NextResponse.json({ error: "Description is required" }, { status: 400 });
      }
      userPrompt = buildDescribePrompt(description.trim(), presetName?.trim() || "HelixForge Preset");
    }

    const message = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 8192,
      system: HELIX_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "";

    let parsed: { meta: unknown; hsp: unknown };
    try {
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/s);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse AI response. Try again.", raw },
        { status: 500 }
      );
    }

    if (!parsed.meta || !parsed.hsp) {
      return NextResponse.json({ error: "Incomplete AI response. Try again." }, { status: 500 });
    }

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Forge error:", error);
    return NextResponse.json({ error: "Generation failed. Check your API key." }, { status: 500 });
  }
}
