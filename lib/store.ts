import { prisma } from "@/lib/prisma";

// Queue + live-chat polling state, backed by Postgres via Prisma.
// Previously a JSON file (data/state.json) — moved here because Vercel's
// serverless functions have a read-only filesystem outside /tmp, and /tmp
// itself is ephemeral and not shared across concurrent instances, so a
// file on disk can't survive between requests there.

export interface QueueItem {
  id: number; // database id — lets "advance" target one specific item
  videoId: string;
  title: string;
  requestedBy: string;
  requestedAt: number; // epoch ms — kept for API-response shape compatibility
}

interface YoutubeState {
  liveChatId?: string;
  nextPageToken?: string;
  lastPolledAt?: number; // epoch ms
  pollingIntervalMs?: number;
}

function toQueueItem(row: {
  id: number;
  videoId: string;
  title: string;
  requestedBy: string;
  requestedAt: Date;
}): QueueItem {
  return {
    id: row.id,
    videoId: row.videoId,
    title: row.title,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.getTime()
  };
}

// Chat state is a singleton row, like YoutubeCredentials — "the state" just
// means "the first/only row", since its id is a random UUID rather than a
// fixed value we could upsert against.
export async function getYoutubeState(): Promise<YoutubeState> {
  const row = await prisma.youtubeChatState.findFirst();
  if (!row) return {};
  return {
    liveChatId: row.liveChatId ?? undefined,
    nextPageToken: row.nextPageToken ?? undefined,
    lastPolledAt: row.lastPolledAt?.getTime(),
    pollingIntervalMs: row.pollingIntervalMs ?? undefined
  };
}

export async function saveYoutubeState(update: YoutubeState): Promise<void> {
  const existing = await prisma.youtubeChatState.findFirst();

  // `undefined` in `update` means "leave this field alone"; an explicit
  // `undefined` value assigned by the caller (clearing liveChatId, say)
  // still needs to reach the database as `null`. Distinguish the two with
  // `in`, since a plain `?? null` can't tell "not provided" from "provided
  // as undefined" once destructured.
  const liveChatId = "liveChatId" in update ? update.liveChatId ?? null : undefined;
  const nextPageToken = "nextPageToken" in update ? update.nextPageToken ?? null : undefined;
  const lastPolledAt =
    "lastPolledAt" in update
      ? update.lastPolledAt !== undefined
        ? new Date(update.lastPolledAt)
        : null
      : undefined;
  const pollingIntervalMs = "pollingIntervalMs" in update ? update.pollingIntervalMs ?? null : undefined;

  if (existing) {
    await prisma.youtubeChatState.update({
      where: { id: existing.id },
      data: { liveChatId, nextPageToken }
    });
  } else {
    await prisma.youtubeChatState.create({
      data: {
        liveChatId: liveChatId ?? null,
        nextPageToken: nextPageToken ?? null,
        lastPolledAt: lastPolledAt ?? null,
        pollingIntervalMs: pollingIntervalMs ?? null
      }
    });
  }
}

/** The full request queue, oldest first. Item 0, if present, is the one playing now. */
export async function getQueue(): Promise<QueueItem[]> {
  const rows = await prisma.queueItem.findMany({ orderBy: { id: "asc" } });
  return rows.map(toQueueItem);
}

/** Appends a new request to the end of the queue. */
export async function addToQueue(item: Omit<QueueItem, "id">): Promise<void> {
  await prisma.queueItem.create({
    data: {
      videoId: item.videoId,
      title: item.title,
      requestedBy: item.requestedBy,
      requestedAt: new Date(item.requestedAt)
    }
  });
}

/**
 * Removes the currently-playing item and promotes the next one.
 *
 * Pass `expectedId` (the item the caller believes is playing) to make the
 * call safe against duplicates: if that item is no longer first in the
 * queue — because another widget instance, a second player event or the
 * Skip button already advanced it — nothing is removed. Without this a
 * duplicate "ended" event would delete the NEXT song too.
 */
export async function advanceQueue(
  expectedId?: number
): Promise<{ advanced: boolean; current: QueueItem | null }> {
  const rows = await prisma.queueItem.findMany({ orderBy: { id: "asc" }, take: 2 });
  if (rows.length === 0) return { advanced: false, current: null };

  if (expectedId !== undefined && rows[0].id !== expectedId) {
    return { advanced: false, current: toQueueItem(rows[0]) };
  }

  const { count } = await prisma.queueItem.deleteMany({ where: { id: rows[0].id } });
  if (count > 0) await clearPause(); // skipping a paused song starts the next one
  return { advanced: count > 0, current: rows[1] ? toQueueItem(rows[1]) : null };
}

/** Removes a single item from the queue by its position. Returns the updated queue. */
export async function removeQueueItem(index: number): Promise<QueueItem[]> {
  const rows = await prisma.queueItem.findMany({ orderBy: { id: "asc" } });
  const target = rows[index];
  if (target) {
    await prisma.queueItem.delete({ where: { id: target.id } });
    if (index === 0) await clearPause();
  }
  return getQueue();
}

// ---------------------------------------------------------------------------
// Search cache — used by "!request <judul lagu>" (see lib/youtube.ts).
// ---------------------------------------------------------------------------

export interface CachedSearch {
  videoId: string; // "" = a previous search found nothing
  title: string;
  createdAt: number; // epoch ms
}

export async function getCachedSearch(query: string): Promise<CachedSearch | null> {
  const row = await prisma.searchCache.findUnique({ where: { query } });
  if (!row) return null;
  return { videoId: row.videoId, title: row.title, createdAt: row.createdAt.getTime() };
}

/** Stores the outcome of a search. Pass null to remember "no result found". */
export async function saveCachedSearch(
  query: string,
  video: { videoId: string; title: string } | null
): Promise<void> {
  const videoId = video?.videoId ?? "";
  const title = (video?.title ?? "").slice(0, 500);
  await prisma.searchCache.upsert({
    where: { query },
    create: { query, videoId, title },
    update: { videoId, title, createdAt: new Date() }
  });
}

/** How many real (non-cached) searches were made since the given moment. */
export async function countSearchesSince(since: Date): Promise<number> {
  return prisma.searchCache.count({ where: { createdAt: { gte: since } } });
}

/**
 * Start of the current YouTube API quota day. Quota resets at midnight
 * Pacific Time, not at midnight in the streamer's own timezone.
 */
export function startOfQuotaDay(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const sinceMidnightMs = ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000;
  return new Date(now.getTime() - sinceMidnightMs - now.getMilliseconds());
}

// ---------------------------------------------------------------------------
// Last "advance" (song change) — shown on /queue to diagnose unexpected skips.
// Kept in memory on globalThis (shared by all route bundles in `next dev`);
// it's debug info only, so it's fine that it resets on server restart.
// ---------------------------------------------------------------------------

export interface LastAdvance {
  at: number; // epoch ms
  reason: string; // ended | error | stalled | manual
  advanced: boolean; // false = ignored as stale/duplicate
  detail: Record<string, unknown> | null; // widget instance id, player time, visibility, ...
}

const advanceGlobal = globalThis as unknown as { __lastAdvance?: LastAdvance };

export function recordAdvance(info: LastAdvance): void {
  advanceGlobal.__lastAdvance = info;
}

export function getLastAdvance(): LastAdvance | null {
  return advanceGlobal.__lastAdvance ?? null;
}

// ---------------------------------------------------------------------------
// Pause (moderation) — "hold the current song while I check what it is".
// ---------------------------------------------------------------------------

let warnedMissingPlaybackTable = false;

/** Whether the current song is paused. Never throws: if the table isn't there yet, reads as "not paused". */
export async function getPaused(): Promise<boolean> {
  try {
    const row = await prisma.playbackState.findUnique({ where: { id: 1 } });
    return row?.paused ?? false;
  } catch (err) {
    if (!warnedMissingPlaybackTable) {
      warnedMissingPlaybackTable = true;
      console.error("[pause] cannot read PlaybackState — run `npm run db:push` and `npx prisma generate`", err);
    }
    return false;
  }
}

export async function setPaused(paused: boolean): Promise<void> {
  await prisma.playbackState.upsert({
    where: { id: 1 },
    create: { id: 1, paused },
    update: { paused }
  });
}

/** Called whenever the current song is removed, so the next song isn't born paused. Best effort. */
async function clearPause(): Promise<void> {
  try {
    await prisma.playbackState.updateMany({ where: { id: 1 }, data: { paused: false } });
  } catch {
    // table missing (db:push not run yet) — nothing to clear
  }
}
