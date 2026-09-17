# YouTube Chat Widget

A "Now Playing" widget for OBS that is connected to YouTube Live Chat:
Whenever a viewer sends a link in the chat,
the song is automatically played and displayed in the widget.
Built with **Next.js (App Router) + TypeScript + Prisma (PostgreSQL)**.

## Project Structure

```
prisma/
  schema.prisma                      # YoutubeCredentials model (one row: YOUTUBE_API_KEY +
                                       YOUTUBE_VIDEO_ID)
app/
  page.tsx                           # dashboard: manage YouTube configuration & widget link
  components/YoutubeConfigPanel.tsx  # UI for adding / changing Video ID / deleting
                                       configuration
  queue/page.tsx                     # queue management page (skip / remove requests)
  widget/page.tsx                    # widget page (YouTube player, for OBS)
  api/config/                        # CRUD configuration (GET/POST/PUT/DELETE) to the database
  api/youtube/poll/                  # read live chat, process "!request", populate the queue
  api/youtube/queue/                 # read by the widget & queue page: current + upcoming
  api/youtube/queue/remove/          # remove a specific item from the queue
  api/youtube/advance/               # advance the queue (called when a video finishes/is skipped)
lib/
  prisma.ts                          # PrismaClient instance
  config.ts                          # read/write YouTube configuration in the database
  youtube.ts                         # YouTube Data API calls: live chat, resolve video links
  store.ts                           # local JSON file storage for queue & live chat state
```

## 1. Install

```bash
npm install
cp .env.local.example .env.local
```

`npm install` automatically runs `prisma generate` (see the `postinstall` script in `package.json`).

## 2. Database Setup (PostgreSQL)

1. Set up a Postgres database — locally (`postgres.app`, Docker, etc.) or
   through a managed service (Supabase, Neon, Railway, etc.).
2. Set `DATABASE_URL` in `.env.local` / `.env`:
   ```
   DATABASE_URL="postgresql://user:password@localhost:5432/youtube_widget"
   ```
3. Create the tables:
   ```bash
   npx prisma db push
   ```
   This reads `prisma/schema.prisma` (the `YoutubeCredentials` model) and creates the table in the database specified by `DATABASE_URL`. Run this command again whenever `schema.prisma` is modified.

Technical note: `prisma/schema.prisma` uses the `prisma-client` generator (instead of the older `prisma-client-js`) with a custom output pointing to lib/generated/prisma. This generator connects to the database through a **driver adapter** (`@prisma/adapter-pg`), rather than the built-in query engine — which is why `lib/prisma.ts` creates `PrismaClient` with `new PrismaClient({ adapter })`, rather than simply using `new PrismaClient()`. The generated output folder (lib/generated/) is ignored through `.gitignore` and recreated automatically by `prisma generate` (which runs automatically through `postinstall` whenever `npm install` is executed).

Optional: `npm run db:studio` opens Prisma Studio so you can view or modify the table contents directly through your browser.

## 3. Setup YouTube API Key & Video ID

Unlike before, YouTube credentials are no longer stored in .env —
they are managed directly from the application dashboard:

1. Open [Google Cloud Console](https://console.cloud.google.com/), create a
   project, enable **YouTube Data API v3**, and create an **API key**.
2. Start the application (`npm run dev`) and open `http://localhost:3000`.
3. In the **"1 — Point it at your stream"** card, click **Add Configuration**, enter the API Key and Video ID
   then save. The data is stored in Postgres through Prisma.
   - **Video ID** is the 11-character video ID, regardless of where it appears in the URL — for example, after `?v=`, after `youtu.be/`, or after `youtube.com/live/`.
   - The video **must currently be live** and **live chat must be enabled** for the chat to be read.
4. When the stream changes (a new stream goes live), click **Change Video ID** to enter the new Video ID
   without having to replace the API Key.
5. **Delete** removes the entire configuration — live chat polling will automatically stop until a new
   configuration is added.

## 4. Run

```bash
npm run dev
```

Open `http://localhost:3000` to manage the configuration and view the widget link.

## 5. Add to OBS

Copy the widget URL from the dashboard (`http://localhost:3000/widget?youtube=1`), then in OBS: **Sources → + → Browser**, paste the URL, and set the size according to your scene (this widget also plays the video, so give it enough space to actually watch it rather than using only a small strip).

The `?youtube=1` parameter makes that widget instance also monitor YouTube chat. If you place the same widget in multiple scenes, only **one** instance should use `?youtube=1` — the others should omit the parameter so they only follow the queue(mirror) and do not independently poll YouTube chat.

## How the Song Request Flow Works

1. A viewer sends a chat message, for example: `!request https://youtu.be/dQw4w9WgXcQ`.
2. `app/api/youtube/poll` retrieves the API Key & Video ID from
   the database (`lib/config.ts`), reads new messages through the YouTube Data API, and detects the `!request` command in `lib/youtube.ts`.
3. The argument must be a YouTube link — the video ID is extracted directly from the link.
   If it is not a link (for example, a regular song title), the request is skipped (`skipped`, reason `not_a_youtube_link`) and is not added to the queue.
4. Successfully resolved videos are added to the **queue** (`lib/store.ts`) and processed
   sequentially according to the order in which the messages were received — the currently playing video is not immediately replaced.
5. The widget (`app/widget`) polls the queue every few seconds through
   `app/api/youtube/queue`, plays the first video using the YouTube IFrame Player, and automatically advances the queue (`app/api/youtube/advance`) when the video finishes
6. The `/queue` page displays the same queue in real time and provides a **Skip Song**
   button (for the currently playing song) as well as a **Delete** button (for any item in the queue) — these controls are used through a regular browser, not through OBS.

## Rate Limits & Stale liveChatId on YouTube Live Chat

`app/api/youtube/poll` follows the pollingIntervalMillis recommended by YouTube in its response rather than using a fixed interval — do not call this endpoint more frequently than recommended, as doing so can trigger 403 rateLimitExceeded.

A stored `liveChatId` is automatically reset (and then resolved again from the Video ID) only when YouTube explicitly reports that the chat no longer exists (`liveChatNotFound`, `liveChatEnded`, or the video is no longer live). For temporary errors such as rate limits, `nextPageToken` is **not** reset. This prevents the same messages from being read again and causing duplicate requests to be added to the queue.

## Production Notes

- YouTube configuration (API Key + Video ID) is stored in Postgres through
   Prisma — making it safe to deploy to platforms with read-only/ephemeral filesystems (such as Vercel), since this configuration no longer depends on local files or `.env` for persistent data.
- The song queue & live chat state (`liveChatId`, `nextPageToken`) are still stored in
   `data/state.json` (a local file) — this is suitable for personal/single-stream usage running on a single server/process. If deployed to a serverless platform, this part should also be moved to external storage (such as an additional Postgres table or Redis/Upstash) so the state remains consistent with the Prisma-based approach above.
- A public YouTube API key is sufficient for reading live chat and video metadata
   from a public live video. If you want to read chat from an unlisted/private video, YouTube OAuth is required instead of an API key alone.
- The `search.list` quota (100 units/call) is significantly more expensive than 
   `videos.list/liveChatMessages.list` (1–5 units) — this is why `!request` only accepts direct YouTube links instead of free-text titles searched through `search.list`. See the "Rate Limits & Stale liveChatId" section above for how to minimize the quota cost of live chat polling.