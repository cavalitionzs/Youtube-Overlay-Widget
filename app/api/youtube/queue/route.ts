import { NextResponse } from "next/server";
import { getQueue } from "@/lib/store";

// The widget polls this to know what to play and what's coming up.
// queue[0] is "now playing"; everything after that is "up next".
export async function GET() {
  const queue = await getQueue();
  const [current, ...upcoming] = queue;
  return NextResponse.json({ current: current ?? null, upcoming });
}
