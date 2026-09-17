import { NextRequest, NextResponse } from "next/server";
import { removeQueueItem } from "@/lib/store";

// Removes a single queue entry by its position (0 = currently playing,
// same effect as /api/youtube/advance for that case; 1+ = an upcoming item).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const index: number | undefined = body?.index;

  if (typeof index !== "number" || index < 0) {
    return NextResponse.json({ error: "invalid_index" }, { status: 400 });
  }

  const queue = await removeQueueItem(index);
  const [current, ...upcoming] = queue;
  return NextResponse.json({ current: current ?? null, upcoming });
}
