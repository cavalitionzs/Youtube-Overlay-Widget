import YoutubeConfigPanel from "./components/YoutubeConfigPanel";

export default function DashboardPage() {
  const baseUrl = process.env.NEXT_BASE_URL;
  const widgetUrl = `${baseUrl}/widget?youtube=1`;

  return (
    <div className="page-dashboard">
      <main style={{ maxWidth: 460, margin: "0 auto", padding: "48px 20px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 28,
          }}
        >
          <YoutubeMark />
          <span
            style={{
              fontSize: 13,
              letterSpacing: "0.04em",
              color: "var(--muted)",
            }}
          >
            YOUTUBE SONG REQUESTS · LIVE CHAT
          </span>
        </div>

        <h1
          style={{
            fontSize: "clamp(28px, 5vw, 36px)",
            lineHeight: 1.08,
            margin: "0 0 8px",
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          Chat requests, played live
        </h1>
        <p
          style={{
            color: "var(--muted)",
            fontSize: 15,
            lineHeight: 1.5,
            margin: "0 0 28px",
          }}
        >
          Viewers type <code style={codeStyle}>!request</code> with a YouTube
          link in your live chat, it joins the queue, and the overlay plays it
          automatically.
        </p>

        <Card title="1 — Point it at your stream">
          <p
            style={{
              margin: "0 0 16px",
              color: "var(--muted)",
              fontSize: 14,
              lineHeight: 1.7,
            }}
          >
            API Key dan Video ID disimpan di database, jadi bisa ditambah atau
            diubah kapan saja tanpa restart server.
          </p>
          <YoutubeConfigPanel />
        </Card>

        <Card title="2 — How requests work">
          <p
            style={{
              margin: 0,
              color: "var(--muted)",
              fontSize: 14,
              lineHeight: 1.7,
            }}
          >
            A chat message like{" "}
            <code style={codeStyle}>!request https://youtu.be/dQw4w9WgXcQ</code>{" "}
            gets added to the queue. Only a direct YouTube link is accepted —
            free-text title search was removed because it burns 100x more
            YouTube API quota per request than resolving a link. Requests play
            in the order they arrive — the next one starts automatically when
            the current video ends.
          </p>
        </Card>

        <Card title="3 — Add the overlay to OBS">
          <p
            style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 14 }}
          >
            Sources → + → Browser. Paste this URL and size it to your scene.
            Keep this source running — it's also what polls YouTube chat for new
            requests and plays the video/audio.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input readOnly value={widgetUrl} style={inputStyle} />
          </div>
          <p
            style={{
              fontSize: 12.5,
              color: "var(--muted)",
              marginTop: 10,
              lineHeight: 1.5,
            }}
          >
            Only one browser source should have{" "}
            <code style={codeStyle}>?youtube=1</code> — that's the one driving
            the chat poller. Extra copies of the widget without that param will
            just mirror whatever's currently queued, without polling chat
            themselves.
          </p>
        </Card>

        <Card title="4 — Manage the queue">
          <p
            style={{
              margin: "0 0 14px",
              color: "var(--muted)",
              fontSize: 14,
              lineHeight: 1.7,
            }}
          >
            See what's playing and what's coming up, and skip or remove
            requests, from a page you can open on your own screen (not the OBS
            overlay).
          </p>
          <a href="/queue" style={btnStyle}>
            Open queue manager
          </a>
        </Card>
      </main>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--panel-edge)",
        borderRadius: 14,
        padding: 22,
        marginBottom: 16,
      }}
    >
      <h2
        style={{
          fontSize: 12,
          color: "var(--green)",
          margin: "0 0 14px",
          fontWeight: 600,
        }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

function YoutubeMark() {
  return (
    <svg viewBox="0 0 24 24" width={24} height={24}>
      <rect x="1" y="5" width="22" height="14" rx="5" fill="#ff0033" />
      <path d="M10 8.5v7l6-3.5-6-3.5Z" fill="#fff" />
    </svg>
  );
}

const btnStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "13px 20px",
  borderRadius: 9,
  background: "var(--green)",
  color: "#08170e",
  fontWeight: 700,
  fontSize: 14,
  textDecoration: "none",
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "11px 12px",
  borderRadius: 8,
  border: "1px solid var(--panel-edge)",
  background: "#0f120f",
  color: "var(--paper)",
  fontSize: 13,
  fontFamily: "var(--mono)",
};

const codeStyle: React.CSSProperties = {
  background: "#0f120f",
  border: "1px solid var(--panel-edge)",
  borderRadius: 5,
  padding: "1px 6px",
  fontFamily: "var(--mono)",
  fontSize: 12.5,
  color: "var(--green)",
};
