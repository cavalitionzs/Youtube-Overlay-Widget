import { NextRequest, NextResponse } from "next/server";
import {
  getYoutubeConfig,
  createYoutubeConfig,
  updateYoutubeVideoId,
  deleteYoutubeConfig
} from "@/lib/config";

// GET: read the current config (404 if none has been added yet).
export async function GET() {
  const config = await getYoutubeConfig();
  if (!config) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(config);
}

// POST: create the config for the first time (both apiKey and videoId).
// Guarded against duplicates here in code, since YoutubeCredentials.id is
// now a random UUID rather than a fixed id we could upsert against.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  const videoId = typeof body?.videoId === "string" ? body.videoId.trim() : "";

  if (!apiKey || !videoId) {
    return NextResponse.json({ error: "apiKey dan videoId wajib diisi" }, { status: 400 });
  }

  const existing = await getYoutubeConfig();
  if (existing) {
    return NextResponse.json(
      { error: "Konfigurasi sudah ada — gunakan 'Ubah Video ID' atau hapus dulu." },
      { status: 409 }
    );
  }

  const config = await createYoutubeConfig({ apiKey, videoId });
  return NextResponse.json(config);
}

// PUT: update just the videoId of an existing config.
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const videoId = typeof body?.videoId === "string" ? body.videoId.trim() : "";

  if (!videoId) {
    return NextResponse.json({ error: "videoId wajib diisi" }, { status: 400 });
  }

  try {
    const config = await updateYoutubeVideoId(videoId);
    return NextResponse.json(config);
  } catch {
    return NextResponse.json(
      { error: "Konfigurasi belum ada — tambahkan dulu" },
      { status: 404 }
    );
  }
}

// DELETE: remove the config entirely.
export async function DELETE() {
  await deleteYoutubeConfig();
  return NextResponse.json({ ok: true });
}
