import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const SYSTEM_PROMPT = `You read screenshots of DAW Marker windows (Cubase, Logic, Pro Tools, Reaper, etc.) and extract the marker list as plain text.

Output format — one marker per line, EXACTLY this shape:
M:SS NAME
or
M:SS.SS NAME
or
H:MM:SS NAME

Examples:
0:08 INTRO
4:38.5 VERSE 1
1:02:14 BRIDGE

Rules:
- Use the marker's TIME POSITION (start time), not bar/beat numbers if both are visible.
- Use the marker's DESCRIPTION/NAME (not the ID number).
- One marker per line. Preserve order from the screenshot.
- Drop columns like "Length", "Type", "ID" — only emit time + name.
- If the time is shown as 0:00:08:000 or H:MM:SS:MS, convert to M:SS or M:SS.fraction.
- If the marker has no description, use "SECTION N" where N is the row index (1-based).
- Output ONLY the marker lines, no headers, no commentary, no markdown fences.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const imageBase64 = body.imageBase64 as string | undefined;
    const mediaType = (body.mediaType as string | undefined) || "image/png";

    if (!imageBase64) {
      return NextResponse.json({ error: "imageBase64 is required" }, { status: 400 });
    }

    // Strip a data URL prefix if present
    const cleaned = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");

    const message = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
                data: cleaned,
              },
            },
            { type: "text", text: "Extract every marker from this screenshot as 'M:SS NAME' lines." },
          ],
        },
      ],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "";
    const markers = raw.trim();

    if (!markers) {
      return NextResponse.json({ error: "Claude returned no markers from this image. Try a clearer screenshot of just the marker list." }, { status: 422 });
    }

    return NextResponse.json({ markersText: markers });
  } catch (err) {
    console.error("parse-markers error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Marker parsing failed" },
      { status: 500 }
    );
  }
}
