export interface ChatMessage {
  authorName: string;
  text: string;
  publishedAt: string;
}

/** Looks up the active live chat id for a video that is currently live. */
export async function resolveLiveChatId(videoId: string, apiKey: string): Promise<string> {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "liveStreamingDetails");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`YouTube videos.list failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const chatId = data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
  if (!chatId) throw new Error("video_not_live_or_chat_disabled");
  return chatId;
}

/** Fetches one page of new chat messages since the given page token. */
export async function fetchChatMessages(
  liveChatId: string,
  apiKey: string,
  pageToken?: string
): Promise<{ messages: ChatMessage[]; nextPageToken: string; pollingIntervalMs: number }> {
  const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
  url.searchParams.set("liveChatId", liveChatId);
  url.searchParams.set("part", "snippet,authorDetails");
  url.searchParams.set("key", apiKey);
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`YouTube liveChat.messages failed: ${res.status} ${await res.text()}`);
  const data = await res.json();

  const messages: ChatMessage[] = (data.items ?? []).map(
    (item: {
      snippet: { displayMessage?: string; publishedAt: string };
      authorDetails: { displayName: string };
    }) => ({
      authorName: item.authorDetails?.displayName ?? "someone",
      text: item.snippet?.displayMessage ?? "",
      publishedAt: item.snippet?.publishedAt
    })
  );

  return {
    messages,
    nextPageToken: data.nextPageToken,
    pollingIntervalMs: data.pollingIntervalMillis ?? 5000
  };
}

const VIDEO_ID_REGEX =
  /(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

/** Pulls an 11-char YouTube video id out of a full URL, if one is present. */
export function extractYoutubeVideoId(text: string): string | null {
  const match = text.match(VIDEO_ID_REGEX);
  return match ? match[1] : null;
}

const REQUEST_COMMAND_REGEX = /^!request\s+(.+)$/i;

/** Pulls the argument out of a "!request <...>" chat message, if present. */
export function parseRequestCommand(text: string): string | null {
  const match = text.trim().match(REQUEST_COMMAND_REGEX);
  return match ? match[1].trim() : null;
}

export interface ResolvedVideo {
  videoId: string;
  title: string;
}

/** Looks up a video's title by id (used when the request was a direct link). */
async function getVideoTitle(videoId: string, apiKey: string): Promise<string | null> {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  return data.items?.[0]?.snippet?.title ?? null;
}

/**
 * Resolves the argument of a "!request <link>" message into a playable
 * video. Only accepts a direct YouTube link — free-text search was removed
 * because it required search.list, which costs 100 quota units per call
 * (100x more than the videos.list lookup used here), and was the single
 * biggest contributor to hitting the daily quota.
 */
export async function resolveRequest(argument: string, apiKey: string): Promise<ResolvedVideo | null> {
  const directId = extractYoutubeVideoId(argument);
  if (!directId) return null;

  const title = (await getVideoTitle(directId, apiKey)) ?? "Unknown title";
  return { videoId: directId, title };
}
