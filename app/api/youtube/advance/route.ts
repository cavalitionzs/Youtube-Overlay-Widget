import { NextRequest, NextResponse } from "next/server";
import { advanceQueue } from "@/lib/store";

export const dynamic = "force-dynamic";

// Pops the currently-playing item off the queue and promotes whatever's next.
//
// The widget sends { id, reason } where `id` is the queue item it was
// playing and `reason` is "ended" | "error" | "stalled". If that item is no
// longer the current one the call is ignored (see advanceQueue). The Skip
// button on /queue sends no body and always skips.
//
// Every call is logged so an unexpected skip can be traced to its cause.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const expectedId: number | undefined = typeof body?.id === "number" ? body.id : undefined;
  const reason: string = typeof body?.reason === "string" ? body.reason : "manual";

  const { advanced, current } = await advanceQueue(expectedId);
  console.log(
    `[advance] reason=${reason} id=${expectedId ?? "-"} -> ${
      advanced ? "advanced" : "ignored (already advanced / stale)"
    }`
  );
  return NextResponse.json({ current, advanced });
}
