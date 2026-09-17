import { NextResponse } from "next/server";
import { advanceQueue } from "@/lib/store";

// The widget calls this when the currently-playing video ends, to pop it
// off the queue and promote whatever's next.
export async function POST() {
  const current = await advanceQueue();
  return NextResponse.json({ current });
}
