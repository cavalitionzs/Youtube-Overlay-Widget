import { getCachedSearch, saveCachedSearch, countSearchesSince, startOfQuotaDay } from "@/lib/store";

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
// export async function resolveRequest(argument: string, apiKey: string): Promise<ResolvedVideo | null> {
//   const directId = extractYoutubeVideoId(argument);
//   if (!directId) return null;

//   const title = (await getVideoTitle(directId, apiKey)) ?? "Unknown title";
//   return { videoId: directId, title };
// }

// ---------------------------------------------------------------------------
// Text search: "!request <judul>" and "!request <judul> <artis>"

// search.list costs 100 quota units per call (videos.list costs 1), so every
// search is protected by: a persistent cache, a daily search budget, and a
// limit of one fresh search per viewer per poll batch.
// ---------------------------------------------------------------------------

const MAX_QUERY_LENGTH = 100;
/** Max fresh searches per quota day. 60 searches = 6,000 of the 10,000 default daily units. */
const MAX_SEARCHES_PER_DAY = Number(process.env.YOUTUBE_MAX_SEARCHES_PER_DAY ?? 60);
/** Skip results longer than this (full albums, 1-hour mixes, ...). 0 = no limit. */
const MAX_SONG_SECONDS = Number(process.env.YOUTUBE_MAX_SONG_SECONDS ?? 10 * 60);
const FOUND_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NOT_FOUND_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MUSIC_CATEGORY_ID = "10";

export type SkipReason =
  | "empty_query"
  | "unsupported_link" // a URL, but not a YouTube one (Spotify, etc.)
  | "no_results"
  | "search_rate_limited" // this viewer already triggered a search in this batch
  | "search_limit_reached" // daily budget (or YouTube quota) used up
  | "search_failed";

export type ResolveOutcome =
  | { ok: true; video: ResolvedVideo; source: "link" | "cache" | "search" }
  | { ok: false; reason: SkipReason };

/** Cleans up a free-text query: strips quotes, collapses whitespace, caps length. */
export function normalizeSearchQuery(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/["“”‘’`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
    .trim();
}

// Built from a string because \p{...} needs a newer regex target than tsconfig's ES2017.
const NON_WORD_REGEX = new RegExp("[^\\p{L}\\p{N}]+", "gu");

/** Cache key: "Judul - Artis!" and "judul artis" are the same song. */
export function searchCacheKey(query: string): string {
  return query.toLowerCase().replace(NON_WORD_REGEX, " ").trim();
}

/** Parses an ISO-8601 duration such as "PT3M45S" into seconds. */
export function parseIsoDurationSeconds(iso: string | undefined): number {
  const m = iso?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const [, d = "0", h = "0", min = "0", sec = "0"] = m;
  return Number(d) * 86400 + Number(h) * 3600 + Number(min) * 60 + Number(sec);
}

interface VideoDetails {
  id: string;
  snippet?: { title?: string; categoryId?: string; liveBroadcastContent?: string };
  contentDetails?: { duration?: string };
  status?: { embeddable?: boolean; privacyStatus?: string };
}

/**
 * Searches YouTube for a song. Costs 100 units (search.list) + 1 unit
 * (videos.list, to check embeddable / duration / category of the top hits).
 * Returns null when nothing playable was found.
 */
async function searchVideo(query: string, apiKey: string): Promise<ResolvedVideo | null> {
  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("part", "id");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("videoEmbeddable", "true"); // the widget plays through the embedded player
  searchUrl.searchParams.set("maxResults", "5");
  searchUrl.searchParams.set("key", apiKey);

  const searchRes = await fetch(searchUrl.toString(), { cache: "no-store" });
  if (!searchRes.ok) throw new Error(`YouTube search.list failed: ${searchRes.status} ${await searchRes.text()}`);
  const searchData = await searchRes.json();
  const ids: string[] = (searchData.items ?? [])
    .map((item: { id?: { videoId?: string } }) => item.id?.videoId)
    .filter((id: string | undefined): id is string => Boolean(id));
  if (ids.length === 0) return null;

  const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  detailsUrl.searchParams.set("part", "snippet,contentDetails,status");
  detailsUrl.searchParams.set("id", ids.join(","));
  detailsUrl.searchParams.set("key", apiKey);

  const detailsRes = await fetch(detailsUrl.toString(), { cache: "no-store" });
  if (!detailsRes.ok) throw new Error(`YouTube videos.list failed: ${detailsRes.status} ${await detailsRes.text()}`);
  const detailsData = await detailsRes.json();
  const byId = new Map<string, VideoDetails>(
    (detailsData.items ?? []).map((v: VideoDetails) => [v.id, v])
  );

  // Keep YouTube's relevance order, but drop anything the widget can't play well.
  const playable = ids
    .map((id) => byId.get(id))
    .filter((v): v is VideoDetails => {
      if (!v) return false;
      if (v.status?.embeddable === false) return false;
      if (v.status?.privacyStatus && v.status.privacyStatus !== "public") return false;
      if (v.snippet?.liveBroadcastContent && v.snippet.liveBroadcastContent !== "none") return false;
      const seconds = parseIsoDurationSeconds(v.contentDetails?.duration);
      if (seconds === 0) return false; // live/premiere placeholders report 0
      if (MAX_SONG_SECONDS > 0 && seconds > MAX_SONG_SECONDS) return false;
      return true;
    });

  // Among the playable hits, prefer one categorised as Music; otherwise take the top hit.
  const best = playable.find((v) => v.snippet?.categoryId === MUSIC_CATEGORY_ID) ?? playable[0];
  if (!best) return null;
  return { videoId: best.id, title: best.snippet?.title ?? "Unknown title" };
}

/**
 * Resolves the argument of a "!request ..." message into a playable video.
 * Accepted forms:
 *   !request https://youtu.be/xxxxxxxxxxx      (direct link, 1 quota unit)
 *   !request <judul lagu>                       (text search)
 *   !request <judul lagu> <nama artis>          (text search, more specific)
 * "Judul - Artis" and "Judul by Artis" also work: the whole text is simply
 * handed to YouTube search, which handles those separators fine.
 *
 * `allowSearch: false` lets the caller refuse a *fresh* search (e.g. one per
 * viewer per batch) while still serving links and cached results.
 */
export async function resolveRequest(
  argument: string,
  apiKey: string,
  opts: { allowSearch?: boolean } = {}
): Promise<ResolveOutcome> {
  const { allowSearch = true } = opts;

  // 1) Direct YouTube link — cheapest path, unchanged behaviour.
  const directId = extractYoutubeVideoId(argument);
  if (directId) {
    const title = (await getVideoTitle(directId, apiKey)) ?? "Unknown title";
    return { ok: true, video: { videoId: directId, title }, source: "link" };
  }

  // 2) Some other URL (Spotify, Apple Music, ...) — searching for URL text is pointless.
  if (/https?:\/\/|www\./i.test(argument)) {
    return { ok: false, reason: "unsupported_link" };
  }

  // 3) Free text: judul, or judul + artis.
  const query = normalizeSearchQuery(argument);
  if (query.length < 2) return { ok: false, reason: "empty_query" };
  const key = searchCacheKey(query);
  if (!key) return { ok: false, reason: "empty_query" }; // e.g. only punctuation/emoji

  const cached = await getCachedSearch(key);
  if (cached) {
    const age = Date.now() - cached.createdAt;
    if (cached.videoId && age < FOUND_CACHE_TTL_MS) {
      return { ok: true, video: { videoId: cached.videoId, title: cached.title }, source: "cache" };
    }
    if (!cached.videoId && age < NOT_FOUND_CACHE_TTL_MS) {
      return { ok: false, reason: "no_results" };
    }
  }

  if (!allowSearch) return { ok: false, reason: "search_rate_limited" };

  if ((await countSearchesSince(startOfQuotaDay())) >= MAX_SEARCHES_PER_DAY) {
    return { ok: false, reason: "search_limit_reached" };
  }

  let video: ResolvedVideo | null;
  try {
    video = await searchVideo(query, apiKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    console.error(err);
    // YouTube itself says the project's quota is gone.
    if (message.includes("quotaExceeded")) return { ok: false, reason: "search_limit_reached" };
    return { ok: false, reason: "search_failed" }; // not cached: a transient error shouldn't block a retry
  }

  await saveCachedSearch(key, video);
  if (!video) return { ok: false, reason: "no_results" };
  return { ok: true, video, source: "search" };
}