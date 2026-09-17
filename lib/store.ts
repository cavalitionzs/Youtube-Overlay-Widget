import { prisma } from "@/lib/prisma";

// Queue + live-chat polling state, backed by Postgres via Prisma.
// Previously a JSON file (data/state.json) — moved here because Vercel's
// serverless functions have a read-only filesystem outside /tmp, and /tmp
// itself is ephemeral and not shared across concurrent instances, so a
// file on disk can't survive between requests there.

export interface QueueItem {
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
  videoId: string;
  title: string;
  requestedBy: string;
  requestedAt: Date;
}): QueueItem {
  return {
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
export async function addToQueue(item: QueueItem): Promise<void> {
  await prisma.queueItem.create({
    data: {
      videoId: item.videoId,
      title: item.title,
      requestedBy: item.requestedBy,
      requestedAt: new Date(item.requestedAt)
    }
  });
}

/** Removes the currently-playing item and promotes the next one. Returns the new current item, or null if the queue is now empty. */
export async function advanceQueue(): Promise<QueueItem | null> {
  const rows = await prisma.queueItem.findMany({ orderBy: { id: "asc" }, take: 2 });
  if (rows.length === 0) return null;

  await prisma.queueItem.delete({ where: { id: rows[0].id } });
  return rows[1] ? toQueueItem(rows[1]) : null;
}

/** Removes a single item from the queue by its position. Returns the updated queue. */
export async function removeQueueItem(index: number): Promise<QueueItem[]> {
  const rows = await prisma.queueItem.findMany({ orderBy: { id: "asc" } });
  const target = rows[index];
  if (target) {
    await prisma.queueItem.delete({ where: { id: target.id } });
  }
  return getQueue();
}
