import { NextResponse } from "next/server";
import { getQueue, getPaused, getLastAdvance } from "@/lib/store";

export const dynamic = "force-dynamic";

// The widget polls this to know what to play and what's coming up.
// queue[0] is "now playing"; everything after that is "up next".
export async function GET() {
  const [queue, paused] = await Promise.all([getQueue(), getPaused()]);
  const [current, ...upcoming] = queue;
  return NextResponse.json({
    current: current ?? null,
    upcoming,
    paused: current ? paused : false,
    lastAdvance: getLastAdvance()
  });
}
