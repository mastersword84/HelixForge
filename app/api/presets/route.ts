import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const modeFilter = searchParams.get("mode");

  let query = supabaseAdmin
    .from("helixforge_presets")
    .select("id, created_at, mode, preset_name, song_title, artist, description, chain, snapshots, sections, midi_info")
    .order("created_at", { ascending: false });

  if (modeFilter) query = query.eq("mode", modeFilter);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { mode, preset_name, song_title, artist, description, chain, snapshots, sections, midi_info, hsp } = body;

  const { data, error } = await supabaseAdmin
    .from("helixforge_presets")
    .insert({ mode, preset_name, song_title, artist, description, chain, snapshots, sections, midi_info, hsp })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
