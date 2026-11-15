"use client";

import { useEffect, useRef, useState } from "react";

interface QueueItem {
  videoId: string;
  title: string;
  requestedBy: string;
  requestedAt: number;
}

interface LastAdvance {
  at: number;
  reason: string;
  advanced: boolean;
  detail: Record<string, unknown> | null;
}

interface QueueData {
  current: QueueItem | null;
  upcoming: QueueItem[];
}

export default function QueuePage() {
  const [data, setData] = useState<QueueData>({ current: null, upcoming: [] });
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [lastAdvance, setLastAdvance] = useState<LastAdvance | null>(null);
  const [paused, setPaused] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const ignoreServerPauseUntilRef = useRef(0);

  async function fetchQueue() {
    try {
      const res = await fetch("/api/youtube/queue", { cache: "no-store" });
      const json = await res.json();
      setData({ current: json.current ?? null, upcoming: json.upcoming ?? [] });
      setLastAdvance(json.lastAdvance ?? null);
      if (Date.now() >= ignoreServerPauseUntilRef.current) setPaused(Boolean(json.paused));
    } catch {
      // keep the last known list on a transient network error
    }
  }

  useEffect(() => {
    fetchQueue();
    const id = setInterval(fetchQueue, 3000);
    return () => clearInterval(id);
  }, []);

  // Pauses / resumes the current song. While paused the OBS widget stops the
  // audio and covers the video and title, so nothing shows on stream.
  async function togglePause() {
    const next = !paused;
    setPauseBusy(true);
    ignoreServerPauseUntilRef.current = Date.now() + 3000;
    setPaused(next);
    try {
      const res = await fetch("/api/youtube/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: next })
      });
      if (!res.ok) setPaused(!next); // could not save (e.g. db:push not run yet)
    } catch {
      setPaused(!next);
    } finally {
      setPauseBusy(false);
    }
  }

  // Skips the song currently playing — it's removed from the queue and
  // whatever was next moves up to "now playing".
  async function skipCurrent() {
    setBusyIndex(0);
    try {
      await fetch("/api/youtube/advance", { method: "POST", cache: "no-store" });
      await fetchQueue();
    } finally {
      setBusyIndex(null);
    }
  }

  // Removes one specific item further down the queue without touching
  // what's currently playing.
  async function removeUpcoming(upcomingIndex: number) {
    const queueIndex = upcomingIndex + 1; // +1 because index 0 is "current"
    setBusyIndex(queueIndex);
    try {
      const res = await fetch("/api/youtube/queue/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: queueIndex })
      });
      const json = await res.json();
      setData({ current: json.current ?? null, upcoming: json.upcoming ?? [] });
    } finally {
      setBusyIndex(null);
    }
  }

  return (
    <div className="page-dashboard">
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 20px" }}>
        <a href="/" style={backLinkStyle}>
          ← Kembali
        </a>

        <h1
          style={{
            fontSize: "clamp(26px, 5vw, 32px)",
            margin: "16px 0 24px",
            fontWeight: 700,
            letterSpacing: "-0.02em"
          }}
        >
          Antrian Lagu
        </h1>

        <h2 style={sectionLabelStyle}>Sedang diputar</h2>
        {!data.current && <EmptyState text="Belum ada lagu yang diputar." />}
        {data.current && (
          <div style={currentCardStyle}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={currentTitleStyle}>{data.current.title}</div>
              <div style={requestedByStyle}>
                diminta oleh {data.current.requestedBy}
                {paused ? " · ⏸ DIJEDA" : ""}
              </div>
            </div>
            <button onClick={togglePause} disabled={pauseBusy} style={pauseButtonStyle}>
              {paused ? "Lanjutkan" : "Jeda"}
            </button>
            <button
              onClick={skipCurrent}
              disabled={busyIndex === 0}
              style={skipButtonStyle}
            >
              {busyIndex === 0 ? "Melewati…" : "Skip Lagu"}
            </button>
          </div>
        )}

        {paused && data.current && (
          <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
            Lagu dijeda: layar widget di OBS menampilkan &quot;Paused&quot; dan judulnya
            disembunyikan. Pilih <b>Lanjutkan</b> untuk meneruskan, atau <b>Skip Lagu</b>
            untuk membuangnya (lagu berikutnya langsung diputar).
          </p>
        )}

        {lastAdvance && (
          <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
            Pergantian lagu terakhir: <b>{lastAdvance.reason}</b>
            {lastAdvance.advanced ? "" : " (diabaikan)"} ·{" "}
            {new Date(lastAdvance.at).toLocaleTimeString()}
            {lastAdvance.detail ? ` · ${JSON.stringify(lastAdvance.detail)}` : ""}
          </p>
        )}

        <h2 style={{ ...sectionLabelStyle, marginTop: 32 }}>
          Selanjutnya ({data.upcoming.length})
        </h2>
        {data.upcoming.length === 0 && <EmptyState text="Antrian kosong." />}
        {data.upcoming.length > 0 && (
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {data.upcoming.map((item, i) => {
              const queueIndex = i + 1;
              return (
                <li key={`${item.videoId}-${item.requestedAt}`} style={queueRowStyle}>
                  <span style={queueNumberStyle}>{i + 1}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={queueTitleStyle}>{item.title}</div>
                    <div style={requestedByStyle}>diminta oleh {item.requestedBy}</div>
                  </div>
                  <button
                    onClick={() => removeUpcoming(i)}
                    disabled={busyIndex === queueIndex}
                    style={removeButtonStyle}
                  >
                    {busyIndex === queueIndex ? "…" : "Hapus"}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </main>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>{text}</p>;
}

const backLinkStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--muted)",
  textDecoration: "none"
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: "0.06em",
  color: "var(--green)",
  fontWeight: 600,
  margin: "0 0 12px",
  textTransform: "uppercase"
};

const currentCardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  background: "var(--panel)",
  border: "1px solid var(--green-dim)",
  borderRadius: 14,
  padding: "16px 18px"
};

const currentTitleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};

const requestedByStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--muted)",
  marginTop: 3
};

const skipButtonStyle: React.CSSProperties = {
  flex: "none",
  padding: "9px 16px",
  borderRadius: 8,
  border: "none",
  background: "var(--green)",
  color: "#08170e",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer"
};

const queueRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  background: "var(--panel)",
  border: "1px solid var(--panel-edge)",
  borderRadius: 12,
  padding: "12px 16px",
  marginBottom: 10
};

const queueNumberStyle: React.CSSProperties = {
  flex: "none",
  width: 22,
  textAlign: "center",
  fontFamily: "var(--mono)",
  fontSize: 12.5,
  color: "var(--muted)"
};

const queueTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};

const removeButtonStyle: React.CSSProperties = {
  flex: "none",
  padding: "7px 12px",
  borderRadius: 8,
  border: "1px solid var(--panel-edge)",
  background: "transparent",
  color: "var(--muted)",
  fontSize: 12.5,
  cursor: "pointer"
};

const pauseButtonStyle: React.CSSProperties = {
  flex: "none",
  padding: "9px 16px",
  borderRadius: 8,
  border: "1px solid var(--green-dim)",
  background: "transparent",
  color: "var(--green)",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer"
};
