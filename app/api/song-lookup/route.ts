import { NextRequest, NextResponse } from "next/server";
import { lookupSong } from "@/lib/song-lookup";

export async function POST(req: NextRequest) {
  try {
    const { title, artist } = await req.json();
    if (!title?.trim() || !artist?.trim()) {
      return NextResponse.json({ error: "title and artist required" }, { status: 400 });
    }
    const result = await lookupSong({ title: title.trim(), artist: artist.trim() });
    return NextResponse.json(result);
  } catch (err) {
    console.error("song-lookup error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "lookup failed" },
      { status: 500 }
    );
  }
}
