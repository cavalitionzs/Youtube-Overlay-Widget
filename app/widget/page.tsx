"use client";

import { useEffect, useRef, useState } from "react";

interface QueueItem {
  id: number;
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
  getDuration: () => number;
  pauseVideo: () => void;
  cueVideoById: (videoId: string) => void;
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
            onReady?: () => void;
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
  const [playerReady, setPlayerReady] = useState(false);
  const playerRef = useRef<YTPlayer | null>(null);
  const loadedVideoIdRef = useRef<string | null>(null);
  const lastProgressRef = useRef<{ time: number; checkedAt: number }>({
    time: 0,
    checkedAt: Date.now(),
  });
  const hasAdvancedRef = useRef(false);
  // True once the current video has actually reported PLAYING. A genuine
  // "ended" can only follow that; an ENDED before it is a spurious event.
  const startedPlayingRef = useRef(false);
  const currentIdRef = useRef<number | null>(null);
  // Moderation pause. `pausedRef` mirrors the state so event handlers and
  // timers never read a stale value; the server value is the source of truth.
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const pausedRef = useRef(false);
  const ignoreServerPauseUntilRef = useRef(0);
  // Random per page load: if /queue shows two different instance ids, the
  // widget is open in more than one place (another OBS scene, a browser tab...).
  const instanceIdRef = useRef(Math.random().toString(36).slice(2, 6));
  const searchParams =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : null;
  const driveYoutubePoll = searchParams?.get("youtube") === "1";

  async function advanceQueueOnServer(
    reason: "ended" | "error" | "stalled",
    detail: Record<string, unknown> = {},
  ) {
    if (hasAdvancedRef.current) return;
    hasAdvancedRef.current = true;
    try {
      await fetch("/api/youtube/advance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        // The server only advances if this item is still the current one.
        body: JSON.stringify({
          id: currentIdRef.current,
          reason,
          detail: {
            ...detail,
            instance: instanceIdRef.current,
            driver: driveYoutubePoll,
            visibility: document.visibilityState,
          },
        }),
      });
    } catch {
      // transient error — the next queue poll will catch up regardless
    }
  }

  // Load the YouTube IFrame Player API once and create the player.
  useEffect(() => {
    function createPlayer() {
      if (!window.YT || playerRef.current) return; // never create two players
      playerRef.current = new window.YT.Player("yt-player", {
        width: "100%",
        height: "100%",
        playerVars: { autoplay: 1, controls: 0, modestbranding: 1, rel: 0 },
        events: {
          // The player object exists right after `new YT.Player(...)`, but
          // methods like loadVideoById/playVideo/getCurrentTime are only
          // attached once it reports ready. Calling them earlier throws
          // "loadVideoById is not a function" (e.g. right after a refresh,
          // when the queue already has a current song).
          onReady: () => setPlayerReady(true),
          onStateChange: (event) => {
            if (!window.YT) return;
            if (event.data === window.YT.PlayerState.PLAYING) {
              startedPlayingRef.current = true;
            } else if (event.data === window.YT.PlayerState.ENDED) {
              const p = playerRef.current;
              const time = p?.getCurrentTime?.() ?? 0;
              const duration = p?.getDuration?.() ?? 0;
              // A real "ended" comes after the video played and at (about)
              // its end. Anything else — e.g. an ENDED fired while a new
              // video is still loading — must not throw away the song.
              const nearEnd = duration === 0 || time >= duration - 5;
              if (!startedPlayingRef.current || !nearEnd) {
                console.warn("[widget] ignoring spurious ENDED", {
                  startedPlaying: startedPlayingRef.current,
                  time,
                  duration,
                });
                return;
              }
              advanceQueueOnServer("ended", { time, duration });
            } else if (event.data === window.YT.PlayerState.PAUSED) {
              // Keeps the old behaviour (nobody can pause it by clicking the
              // video), except when a moderator paused it on purpose.
              if (!pausedRef.current) playerRef.current?.playVideo();
            }
          },
          onError: (event) => {
            setPlayerError(
              PLAYER_ERROR_MESSAGES[event.data] ?? "This video can't be played",
            );
            console.warn("[widget] player error", event.data);
            advanceQueueOnServer("error", { code: event.data });
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
        // Right after a local pause/resume, ignore replies that were already
        // in flight: they still carry the old value and would flip it back.
        if (Date.now() >= ignoreServerPauseUntilRef.current) {
          pausedRef.current = Boolean(data.paused);
          setPaused(pausedRef.current);
        }
        setCurrent(data.current ?? null);
        setUpcoming(data.upcoming ?? []);
      } catch (err) {
        // keep last known frame on a transient network error
        console.error("Failed to fetch /api/youtube/queue", err);
      }
    }

    poll();
    // 2s (was 4s) so a pause from the queue manager reaches OBS quickly.
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Cue a new video into the player only when "current" actually changes.
  useEffect(() => {
    if (!current || !playerReady || !playerRef.current) return;
    if (loadedVideoIdRef.current === current.videoId) return;
    loadedVideoIdRef.current = current.videoId;
    currentIdRef.current = current.id;
    hasAdvancedRef.current = false;
    startedPlayingRef.current = false;
    setPlayerError(null);
    lastProgressRef.current = { time: 0, checkedAt: Date.now() };
    if (pausedRef.current) {
      // Refreshed while paused: cue the video without starting it.
      playerRef.current.cueVideoById(current.videoId);
    } else {
      playerRef.current.loadVideoById(current.videoId);
    }
  }, [current, playerReady]);

  // Apply pause / resume to the player when the flag changes.
  const wasPausedRef = useRef(false);
  useEffect(() => {
    const player = playerRef.current;
    if (!playerReady || !player) return;
    if (paused) {
      player.pauseVideo();
    } else if (wasPausedRef.current) {
      player.playVideo();
    }
    wasPausedRef.current = paused;
  }, [paused, playerReady]);

  async function setPausedOnServer(next: boolean) {
    pausedRef.current = next;
    setPaused(next);
    ignoreServerPauseUntilRef.current = Date.now() + 3000;
    try {
      await fetch("/api/youtube/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ paused: next }),
      });
    } catch {
      // the next queue poll will reconcile with the server
    }
  }

  // Keyboard: P or Space toggles pause (when the OBS "Interact" window has focus).
  useEffect(() => {
    if (!current) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "p" && e.key !== "P" && e.key !== " ") return;
      e.preventDefault();
      setPausedOnServer(!pausedRef.current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current]);

  useEffect(() => {
    if (!current || !playerReady) return;

    const STALL_THRESHOLD_MS = 15000;
    const id = setInterval(() => {
      const player = playerRef.current;
      if (!player || typeof player.getCurrentTime !== "function") return;

      const now = Date.now();
      const time = player.getCurrentTime();
      const last = lastProgressRef.current;

      // A hidden page (background tab, scene that isn't live) can't be judged:
      // its player may be paused by the browser, which is not a real stall,
      // and skipping from there would throw away a song other instances play.
      if (document.visibilityState === "hidden" || pausedRef.current) {
        lastProgressRef.current = { time, checkedAt: now };
        return;
      }

      if (time > last.time + 0.5) {
        lastProgressRef.current = { time, checkedAt: now };
        return;
      }

      if (now - last.checkedAt > STALL_THRESHOLD_MS) {
        setPlayerError("Playback stalled");
        advanceQueueOnServer("stalled", { time });
        lastProgressRef.current = { time, checkedAt: now };
      }
    }, 5000);

    return () => clearInterval(id);
  }, [current, playerReady]);

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
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        background: "#000",
        overflow: "hidden",
      }}
    >
      <div id="yt-player" style={{ width: "100%", height: "100%" }} />

      {/* While paused, cover the video AND the title: the point is to keep
          whatever was requested off the stream until a moderator decides. */}
      {paused && current && (
        <div style={pausedCoverStyle}>
          <span>⏸ Paused</span>
        </div>
      )}

      {playerError && (
        <div style={errorBannerStyle}>
          ⚠ {playerError} — skipping to the next request
        </div>
      )}

      {!current && (
        <div style={idleStyle}>
          <YoutubeMark />
          <span>
            Waiting for a song request — type !request &lt;YouTube link or song title&gt;
          </span>
        </div>
      )}

      {current && !paused && (
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

      {/* Click anywhere (OBS: right-click the source → Interact) to pause or
          resume. This layer also stops clicks from reaching the YouTube
          iframe. The hint only shows while the mouse is over the widget, so
          it never appears on the stream itself. */}
      {current && (
        <div
          onClick={() => setPausedOnServer(!pausedRef.current)}
          style={clickLayerStyle}
        >
          <div style={{ ...hintStyle, opacity: hovered ? 1 : 0 }}>
            {paused ? "▶ Click to resume (or press P)" : "⏸ Click to pause (or press P)"}
          </div>
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

const pausedCoverStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#0c0c0c",
  color: "#e7e7e7",
  fontSize: 15,
  fontWeight: 600,
};

const clickLayerStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  cursor: "pointer",
};

const hintStyle: React.CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  padding: "6px 10px",
  borderRadius: 8,
  background: "rgba(8,8,8,.85)",
  color: "#f6f7f3",
  fontSize: 12,
  fontWeight: 600,
  transition: "opacity .15s",
  pointerEvents: "none",
};
