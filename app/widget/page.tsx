"use client";

import { useEffect, useRef, useState } from "react";

interface QueueItem {
  videoId: string;
  title: string;
  requestedBy: string;
  requestedAt: number;
}

// Minimal shape of the bits of the YT.Player API this widget actually uses.
interface YTPlayer {
  loadVideoById: (videoId: string) => void;
  playVideo: () => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string,
        options: {
          width: string | number;
          height: string | number;
          playerVars?: Record<string, number>;
          events?: {
            onStateChange?: (event: { data: number }) => void;
            onError?: (event: { data: number }) => void;
          };
        },
      ) => YTPlayer;
      PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

// https://developers.google.com/youtube/iframe_api_reference#onError
const PLAYER_ERROR_MESSAGES: Record<number, string> = {
  2: "Invalid video link",
  5: "This video can't be played in an embedded player",
  100: "Video not found (deleted or made private)",
  101: "The video's owner has disabled embedding",
  150: "The video's owner has disabled embedding",
};

export default function WidgetPage() {
  const [current, setCurrent] = useState<QueueItem | null>(null);
  const [upcoming, setUpcoming] = useState<QueueItem[]>([]);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const loadedVideoIdRef = useRef<string | null>(null);
  const lastProgressRef = useRef<{ time: number; checkedAt: number }>({
    time: 0,
    checkedAt: Date.now(),
  });
  const hasAdvancedRef = useRef(false);
  const searchParams =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : null;
  const driveYoutubePoll = searchParams?.get("youtube") === "1";

  async function advanceQueueOnServer() {
    if (hasAdvancedRef.current) return;
    hasAdvancedRef.current = true;
    try {
      await fetch("/api/youtube/advance", {
        method: "POST",
        cache: "no-store",
      });
    } catch {
      // transient error — the next queue poll will catch up regardless
    }
  }

  // Load the YouTube IFrame Player API once and create the player.
  useEffect(() => {
    function createPlayer() {
      if (!window.YT) return;
      playerRef.current = new window.YT.Player("yt-player", {
        width: "100%",
        height: "100%",
        playerVars: { autoplay: 1, controls: 0, modestbranding: 1, rel: 0 },
        events: {
          onStateChange: (event) => {
            if (!window.YT) return;
            if (event.data === window.YT.PlayerState.ENDED) {
              advanceQueueOnServer();
            } else if (event.data === window.YT.PlayerState.PAUSED) {
              playerRef.current?.playVideo();
            }
          },
          onError: (event) => {
            setPlayerError(
              PLAYER_ERROR_MESSAGES[event.data] ?? "This video can't be played",
            );
            advanceQueueOnServer();
          },
        },
      });
    }

    if (window.YT?.Player) {
      createPlayer();
    } else {
      window.onYouTubeIframeAPIReady = createPlayer;
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(tag);
    }
  }, []);

  // Poll the request queue.
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/youtube/queue", { cache: "no-store" });
        if (!res.ok) {
          console.error(
            "/api/youtube/queue returned",
            res.status,
            await res.text(),
          );
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setCurrent(data.current ?? null);
        setUpcoming(data.upcoming ?? []);
      } catch (err) {
        // keep last known frame on a transient network error
        console.error("Failed to fetch /api/youtube/queue", err);
      }
    }

    poll();
    const id = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Cue a new video into the player only when "current" actually changes.
  useEffect(() => {
    if (!current || !playerRef.current) return;
    if (loadedVideoIdRef.current === current.videoId) return;
    loadedVideoIdRef.current = current.videoId;
    hasAdvancedRef.current = false;
    setPlayerError(null);
    lastProgressRef.current = { time: 0, checkedAt: Date.now() };
    playerRef.current.loadVideoById(current.videoId);
  }, [current]);

  useEffect(() => {
    if (!current) return;

    const STALL_THRESHOLD_MS = 15000;
    const id = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;

      const now = Date.now();
      const time = player.getCurrentTime();
      const last = lastProgressRef.current;

      if (time > last.time + 0.5) {
        lastProgressRef.current = { time, checkedAt: now };
        return;
      }

      if (now - last.checkedAt > STALL_THRESHOLD_MS) {
        setPlayerError("Playback stalled");
        advanceQueueOnServer();
        lastProgressRef.current = { time, checkedAt: now };
      }
    }, 5000);

    return () => clearInterval(id);
  }, [current]);

  // Drive the YouTube chat -> queue poller from this same widget instance.
  // The delay between polls adapts to what YouTube's API itself recommends
  // (returned by /api/youtube/poll), instead of a fixed interval — polling
  // faster than that is what causes rateLimitExceeded errors.
  useEffect(() => {
    if (!driveYoutubePoll) return;
    let cancelled = false;

    async function pollYoutube() {
      let nextDelayMs = 6000;
      try {
        const res = await fetch("/api/youtube/poll", { cache: "no-store" });
        const data = await res.json();
        if (typeof data.pollingIntervalMs === "number") {
          nextDelayMs = data.pollingIntervalMs;
        }
      } catch {
        // ignore transient errors, next tick retries at the default delay
      }
      if (!cancelled) setTimeout(pollYoutube, nextDelayMs);
    }

    pollYoutube();
    return () => {
      cancelled = true;
    };
  }, [driveYoutubePoll]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        background: "#000",
        overflow: "hidden",
      }}
    >
      <div id="yt-player" style={{ width: "100%", height: "100%" }} />

      {playerError && (
        <div style={errorBannerStyle}>
          ⚠ {playerError} — skipping to the next request
        </div>
      )}

      {!current && (
        <div style={idleStyle}>
          <YoutubeMark />
          <span>
            Waiting for a song request — type !request &lt;YouTube link&gt;
          </span>
        </div>
      )}

      {current && (
        <div style={overlayStyle}>
          <div
            style={{
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            <span style={titleStyle}>{current.title}</span>
          </div>
          <div style={requestedByStyle}>requested by {current.requestedBy}</div>
          {upcoming.length > 0 && (
            <div style={queueStyle}>
              Up next:{" "}
              {upcoming
                .slice(0, 3)
                .map((v) => v.title)
                .join(" · ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function YoutubeMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={22}
      height={22}
      style={{ opacity: 0.9, flex: "none" }}
    >
      <rect x="1" y="5" width="22" height="14" rx="5" fill="#ff0033" />
      <path d="M10 8.5v7l6-3.5-6-3.5Z" fill="#fff" />
    </svg>
  );
}

const idleStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  color: "#e7e7e7",
  fontSize: 13.5,
  textAlign: "center",
  padding: "0 24px",
  background: "#0c0c0c",
};

const overlayStyle: React.CSSProperties = {
  position: "absolute",
  left: 14,
  right: 14,
  bottom: 14,
  padding: "12px 16px",
  borderRadius: 12,
  background: "rgba(8,8,8,.72)",
  backdropFilter: "blur(6px)",
  color: "#f6f7f3",
  pointerEvents: "none",
};

const titleStyle: React.CSSProperties = {
  fontSize: 15.5,
  fontWeight: 700,
  letterSpacing: "-0.01em",
};

const requestedByStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: "#ff3355",
  fontWeight: 600,
  marginTop: 2,
};

const queueStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: "#c7ccc3",
  marginTop: 6,
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
};

const errorBannerStyle: React.CSSProperties = {
  position: "absolute",
  top: 14,
  left: 14,
  right: 14,
  padding: "10px 14px",
  borderRadius: 10,
  background: "rgba(122, 35, 35, 0.85)",
  color: "#ffe3e3",
  fontSize: 12.5,
  fontWeight: 600,
};
