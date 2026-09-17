import { NextResponse } from "next/server";
import { resolveLiveChatId, fetchChatMessages, parseRequestCommand, resolveRequest } from "@/lib/youtube";
import { getYoutubeState, saveYoutubeState, addToQueue } from "@/lib/store";
import { getYoutubeConfig } from "@/lib/config";

interface PollResult {
  checked: number;
  queued: { videoId: string; title: string; requestedBy: string }[];
  skipped: { requestedBy: string; query: string; reason: string }[];
}

// Call this endpoint on an interval (the widget page does this automatically
// when opened with ?youtube=1) to check for new chat messages and queue any
// "!request <link or title>" commands found in them.
export async function GET() {
  const config = await getYoutubeConfig();
  if (!config) {
    return NextResponse.json(
      { error: "YouTube belum dikonfigurasi. Tambahkan API Key & Video ID di halaman utama." },
      { status: 400 }
    );
  }
  const { apiKey, videoId } = config;

  try {
    const state = await getYoutubeState();
    let liveChatId = state.liveChatId;
    const nextPageToken = state.nextPageToken;

    if (!liveChatId) {
      liveChatId = await resolveLiveChatId(videoId, apiKey);
      await saveYoutubeState({ liveChatId });
    }

    const { messages, nextPageToken: newPageToken, pollingIntervalMs } = await fetchChatMessages(
      liveChatId,
      apiKey,
      nextPageToken
    );
    await saveYoutubeState({ nextPageToken: newPageToken });

    const result: PollResult = { checked: messages.length, queued: [], skipped: [] };

    // Process every "!request" in this batch, in order, so nothing gets
    // dropped when several viewers request at once — they all join the queue.
    for (const message of messages) {
      const query = parseRequestCommand(message.text);
      if (!query) continue;

      try {
        const video = await resolveRequest(query, apiKey);
        if (!video) {
          result.skipped.push({ requestedBy: message.authorName, query, reason: "not_a_youtube_link" });
          continue;
        }
        await addToQueue({
          videoId: video.videoId,
          title: video.title,
          requestedBy: message.authorName,
          requestedAt: Date.now()
        });
        result.queued.push({ ...video, requestedBy: message.authorName });
      } catch {
        result.skipped.push({ requestedBy: message.authorName, query, reason: "resolve_failed" });
      }
    }

    // Never poll faster than YouTube's own suggested interval, plus a small
    // safety margin — this is what actually caused the rate-limit spiral.
    const safePollingIntervalMs = Math.max(pollingIntervalMs, 5000) + 5000;
    return NextResponse.json({ ...result, pollingIntervalMs: safePollingIntervalMs });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown_error";

    // Only re-resolve from scratch when the chat itself is actually gone —
    // "liveChatNotFound"/"liveChatEnded" from YouTube (stream restarted,
    // ended, or chat disabled after we first cached its id), or our own
    // "video_not_live" (the video isn't a live broadcast at all). A cached
    // liveChatId that's gone stale is exactly what causes this error to
    // repeat forever: once cached, the code never calls resolveLiveChatId
    // again unless it's cleared here.
    //
    // A transient failure — rate limiting above all — must NOT clear
    // nextPageToken: doing so makes the next poll re-read the same recent
    // messages (and re-queue the same !request commands) instead of
    // continuing where it left off.
    if (
      message.includes("video_not_live") ||
      message.includes("liveChatNotFound") ||
      message.includes("liveChatEnded")
    ) {
      saveYoutubeState({ liveChatId: undefined, nextPageToken: undefined });
    }

    console.error(err);
    return NextResponse.json({ error: message }, { status: 200 });
  }
}
