import { prisma } from "@/lib/prisma";

export interface YoutubeConfigData {
  apiKey: string;
  videoId: string;
}

// This app manages one stream at a time, so there's always meant to be
// zero or exactly one YoutubeCredentials row. But its id is now a random
// UUID (not a fixed value we can upsert against), so "the config" just
// means "the first/only row" rather than "the row with id = 1".
export async function getYoutubeConfig(): Promise<YoutubeConfigData | null> {
  const record = await prisma.youtubeCredentials.findFirst();
  if (!record) return null;
  return { apiKey: record.YOUTUBE_API_KEY, videoId: record.YOUTUBE_VIDEO_ID };
}

/** Creates the config row. Call only when none exists yet — see the 409 guard in the API route. */
export async function createYoutubeConfig(data: YoutubeConfigData): Promise<YoutubeConfigData> {
  const record = await prisma.youtubeCredentials.create({
    data: { YOUTUBE_API_KEY: data.apiKey, YOUTUBE_VIDEO_ID: data.videoId }
  });
  return { apiKey: record.YOUTUBE_API_KEY, videoId: record.YOUTUBE_VIDEO_ID };
}

/** Updates just the videoId of the existing config row. Throws if none exists yet. */
export async function updateYoutubeVideoId(videoId: string): Promise<YoutubeConfigData> {
  const existing = await prisma.youtubeCredentials.findFirst();
  if (!existing) throw new Error("not_found");

  const record = await prisma.youtubeCredentials.update({
    where: { id: existing.id },
    data: { YOUTUBE_VIDEO_ID: videoId }
  });
  return { apiKey: record.YOUTUBE_API_KEY, videoId: record.YOUTUBE_VIDEO_ID };
}

/** Removes the config row(s). deleteMany (not delete-by-id) so this stays a no-op if none exists. */
export async function deleteYoutubeConfig(): Promise<void> {
  await prisma.youtubeCredentials.deleteMany({});
}
