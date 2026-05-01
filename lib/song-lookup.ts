// ============================================================
// HELIXFORGE — SERVER-SIDE SONG STRUCTURE LOOKUP
// Spotify search (track metadata) → lrclib (synced lyrics) →
// Claude (section inference). Used by cover-song mode when the
// user names a song instead of uploading an audio clip.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";

export interface SongSection {
  name: string;        // "INTRO", "VERSE 1", "CHORUS", "BRIDGE", "SOLO", "OUTRO"
  startSec: number;
  endSec: number;
  startTime: string;   // "1:23"
}

export interface SongLookupResult {
  found: boolean;
  spotify?: {
    id: string;
    title: string;
    artist: string;
    album: string;
    durationSec: number;
  };
  syncedLyrics?: string;
  sections: SongSection[];
  warnings: string[];
}

// ── Spotify token cache (client-credentials tokens last ~1 hour) ──
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getSpotifyToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET missing");

  const auth = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) throw new Error(`Spotify token failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };

  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
}

async function searchSpotify(title: string, artist: string): Promise<SpotifyTrack | null> {
  const token = await getSpotifyToken();
  const q = encodeURIComponent(`track:${title} artist:${artist}`);
  const res = await fetch(
    `https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;

  const data = (await res.json()) as {
    tracks: { items: Array<{ id: string; name: string; artists: { name: string }[]; album: { name: string }; duration_ms: number }> };
  };
  const t = data.tracks?.items?.[0];
  if (!t) return null;

  return {
    id: t.id,
    title: t.name,
    artist: t.artists.map((a) => a.name).join(", "),
    album: t.album.name,
    durationSec: Math.round(t.duration_ms / 1000),
  };
}

async function fetchLrclibLyrics(
  artist: string,
  title: string,
  album?: string,
  durationSec?: number
): Promise<string | null> {
  const params = new URLSearchParams({ artist_name: artist, track_name: title });
  if (album) params.set("album_name", album);
  if (durationSec) params.set("duration", String(durationSec));

  const res = await fetch(`https://lrclib.net/api/get?${params}`, {
    headers: { "User-Agent": "HelixForge (https://github.com/mastersword84/HelixForge)" },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as { syncedLyrics?: string | null; plainLyrics?: string | null };
  return data.syncedLyrics || null;
}

const SECTION_PROMPT = `You are analyzing a song's structure. Given timestamped lyrics, identify the major structural sections.

Return ONLY a JSON array with this exact shape:
[
  { "name": "INTRO", "startSec": 0, "endSec": 22 },
  { "name": "VERSE 1", "startSec": 22, "endSec": 44 },
  { "name": "CHORUS", "startSec": 44, "endSec": 66 }
]

Rules:
- Use these section names only: INTRO, VERSE 1, VERSE 2, VERSE 3, PRE-CHORUS, CHORUS, BRIDGE, SOLO, INTERLUDE, OUTRO
- Repeated choruses can all be named "CHORUS" (they're tonally identical)
- Distinguish VERSE 1 / VERSE 2 / VERSE 3 only if you'd naturally label them differently in a chord chart
- startSec / endSec are integer seconds
- Detect intro from leading instrumental gap (lines with no text or empty timestamps)
- Detect outro from trailing instrumental tail
- Maximum 8 sections total — merge minor variants if needed
- Output ONLY the JSON array, no markdown, no commentary`;

async function analyzeSectionsWithClaude(
  syncedLyrics: string,
  durationSec: number,
  title: string,
  artist: string
): Promise<SongSection[]> {
  const client = new Anthropic();

  const userPrompt = `Song: "${title}" by ${artist}
Total duration: ${durationSec} seconds (${formatTime(durationSec)})

Timestamped lyrics from lrclib:
${syncedLyrics}

Identify the sections.`;

  const message = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 2048,
    system: SECTION_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const raw = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\[[\s\S]*\])/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();

  const parsed = JSON.parse(jsonStr) as Array<{ name: string; startSec: number; endSec: number }>;
  return parsed.map((s) => ({
    name: s.name,
    startSec: s.startSec,
    endSec: s.endSec,
    startTime: formatTime(s.startSec),
  }));
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export async function lookupSong(input: {
  title: string;
  artist: string;
}): Promise<SongLookupResult> {
  const warnings: string[] = [];

  const spotify = await searchSpotify(input.title, input.artist);
  if (!spotify) {
    return { found: false, sections: [], warnings: ["Song not found on Spotify"] };
  }

  const synced = await fetchLrclibLyrics(
    spotify.artist.split(",")[0].trim(),
    spotify.title,
    spotify.album,
    spotify.durationSec
  );

  if (!synced) {
    warnings.push("No synced lyrics found on lrclib — Claude will use general song knowledge for sections");
    return { found: true, spotify, sections: [], warnings };
  }

  let sections: SongSection[] = [];
  try {
    sections = await analyzeSectionsWithClaude(synced, spotify.durationSec, spotify.title, spotify.artist);
  } catch (err) {
    warnings.push(`Section analysis failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  return { found: true, spotify, syncedLyrics: synced, sections, warnings };
}

export function buildSectionSummaryForForge(result: SongLookupResult): string {
  if (!result.found) return "";
  if (!result.spotify) return "";

  const lines: string[] = [
    `SONG STRUCTURE LOOKUP (Spotify + lrclib + Claude analysis):`,
    `Track: "${result.spotify.title}" by ${result.spotify.artist}`,
    `Album: ${result.spotify.album}`,
    `Duration: ${formatTime(result.spotify.durationSec)} (${result.spotify.durationSec}s)`,
    ``,
  ];

  if (result.sections.length === 0) {
    lines.push(`No section data — use your general knowledge of this song.`);
    return lines.join("\n");
  }

  lines.push(`Detected sections (use these timestamps in approxTimestamp):`);
  for (const s of result.sections) {
    lines.push(
      `  ${s.name.padEnd(12)} ${s.startTime} – ${formatTime(s.endSec)} (${s.endSec - s.startSec}s)`
    );
  }

  if (result.warnings.length > 0) {
    lines.push(``, `Notes:`);
    for (const w of result.warnings) lines.push(`  - ${w}`);
  }

  return lines.join("\n");
}
