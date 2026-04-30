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
Your task:
1. Map the song's structural sections (Intro, Verse, Pre-Chorus, Chorus, Bridge, Solo, Breakdown, Outro — whatever applies, max 8) to Helix snapshots.
2. ${audioAnalysis ? "Use the measured audio data above to set each snapshot's tone accurately." : "Use your knowledge of the original recording's tones for each section."}
3. Build ONE Helix preset where each SNAPSHOT = one song section.
4. Provide timestamps for MIDI automation: CC69 values 0–7 trigger snapshots 1–8 in real time from a DAW.

Return a single JSON object:
{
  "meta": {
    "name": "${songTitle} — ${artist}",
    "description": "2-3 sentences on the tone approach and snapshot mapping",
    "chain": ["Block 1", "Block 2", "..."],
    "snapshots": ["INTRO", "VERSE", "CHORUS", ...],
    "sections": [
      {
        "name": "INTRO",
        "snapshotIndex": 0,
        "approxTimestamp": "0:00",
        "toneDescription": "Clean arpeggios, light spring reverb",
        "midiCCValue": 0
      }
    ],
    "midiInfo": {
      "cc": 69,
      "channel": 1,
      "note": "Program CC69 at each timestamp in your DAW. Set Helix to the same MIDI channel."
    }
  },
  "hsp": { ...complete Helix preset JSON... }
}

Snapshot names in "hsp" must match the section names exactly.
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
