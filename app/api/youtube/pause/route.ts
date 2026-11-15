import { NextRequest, NextResponse } from "next/server";
import { setPaused } from "@/lib/store";

export const dynamic = "force-dynamic";

// Pauses / resumes the currently playing song: { "paused": true | false }.
// Explicit value (not a toggle) so a double click or two moderators acting at
// once can't flip it back by accident. The widget reads the value from
// /api/youtube/queue; skipping the song clears it (see advanceQueue).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (typeof body?.paused !== "boolean") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    await setPaused(body.paused);
  } catch (err) {
    console.error("[pause] failed — run `npm run db:push` and `npx prisma generate`", err);
    return NextResponse.json({ error: "pause_unavailable" }, { status: 500 });
  }
  console.log(`[pause] paused=${body.paused}`);
  return NextResponse.json({ paused: body.paused });
}
