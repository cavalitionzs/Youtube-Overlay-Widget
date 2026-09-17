"use client";

import { useEffect, useState } from "react";

interface ConfigData {
  apiKey: string;
  videoId: string;
}

type Mode = "idle" | "create" | "edit-video-id" | "confirm-delete";

export default function YoutubeConfigPanel() {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("idle");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [videoIdInput, setVideoIdInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchConfig() {
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      if (res.status === 404) {
        setConfig(null);
      } else {
        setConfig(await res.json());
      }
    } catch {
      setError("Gagal memuat konfigurasi. Cek koneksi database.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchConfig();
  }, []);

  function openCreate() {
    setError(null);
    setApiKeyInput("");
    setVideoIdInput("");
    setMode("create");
  }

  function openEditVideoId() {
    if (!config) return;
    setError(null);
    setVideoIdInput(config.videoId);
    setMode("edit-video-id");
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKeyInput, videoId: videoIdInput })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menyimpan konfigurasi");
      setConfig(data);
      setMode("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan konfigurasi");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateVideoId(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: videoIdInput })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mengubah Video ID");
      setConfig(data);
      setMode("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengubah Video ID");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/config", { method: "DELETE" });
      if (!res.ok) throw new Error("Gagal menghapus konfigurasi");
      setConfig(null);
      setMode("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus konfigurasi");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>Memuat konfigurasi…</p>;
  }

  return (
    <div>
      {error && <p style={errorStyle}>{error}</p>}

      {/* No config yet: just an "add" button, or the create form. */}
      {!config && mode !== "create" && (
        <button onClick={openCreate} style={btnStyle}>
          Tambah Konfigurasi
        </button>
      )}

      {mode === "create" && (
        <form onSubmit={handleCreate} style={formStyle}>
          <label style={labelStyle}>
            YouTube API Key
            <input
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              required
              style={inputStyle}
              placeholder="AIzaSy…"
              autoComplete="off"
            />
          </label>
          <label style={labelStyle}>
            YouTube Video ID
            <input
              value={videoIdInput}
              onChange={(e) => setVideoIdInput(e.target.value)}
              required
              style={inputStyle}
              placeholder="Bpbdb4z7uvI"
              autoComplete="off"
            />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={saving} style={btnStyle}>
              {saving ? "Menyimpan…" : "Simpan"}
            </button>
            <button type="button" onClick={() => setMode("idle")} style={ghostBtnStyle}>
              Batal
            </button>
          </div>
        </form>
      )}

      {/* Config exists: show it (API key masked) with edit/delete actions. */}
      {config && mode === "idle" && (
        <div style={{ display: "grid", gap: 14 }}>
          <Row label="API Key" value={maskKey(config.apiKey)} />
          <Row label="Video ID" value={config.videoId} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={openEditVideoId} style={btnStyle}>
              Ubah Video ID
            </button>
            <button onClick={() => setMode("confirm-delete")} style={dangerBtnStyle}>
              Hapus
            </button>
          </div>
        </div>
      )}

      {config && mode === "edit-video-id" && (
        <form onSubmit={handleUpdateVideoId} style={formStyle}>
          <label style={labelStyle}>
            Video ID baru
            <input
              value={videoIdInput}
              onChange={(e) => setVideoIdInput(e.target.value)}
              required
              style={inputStyle}
              autoComplete="off"
            />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={saving} style={btnStyle}>
              {saving ? "Menyimpan…" : "Simpan Video ID"}
            </button>
            <button type="button" onClick={() => setMode("idle")} style={ghostBtnStyle}>
              Batal
            </button>
          </div>
        </form>
      )}

      {config && mode === "confirm-delete" && (
        <div style={{ marginTop: 4 }}>
          <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "0 0 12px", lineHeight: 1.6 }}>
            Yakin ingin menghapus konfigurasi ini? Polling live chat akan berhenti sampai
            konfigurasi baru ditambahkan.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleDelete} disabled={saving} style={dangerBtnStyle}>
              {saving ? "Menghapus…" : "Ya, Hapus"}
            </button>
            <button onClick={() => setMode("idle")} style={ghostBtnStyle}>
              Batal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3, letterSpacing: "0.04em" }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontFamily: "var(--mono)", fontSize: 13.5, wordBreak: "break-all" }}>{value}</div>
    </div>
  );
}

function maskKey(key: string): string {
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}${"•".repeat(10)}${key.slice(-4)}`;
}

const btnStyle: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 8,
  border: "none",
  background: "var(--green)",
  color: "#08170e",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer"
};

const ghostBtnStyle: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 8,
  border: "1px solid var(--panel-edge)",
  background: "transparent",
  color: "var(--muted)",
  fontSize: 13,
  cursor: "pointer"
};

const dangerBtnStyle: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 8,
  border: "1px solid #7a2323",
  background: "transparent",
  color: "#ff6b6b",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer"
};

const formStyle: React.CSSProperties = {
  display: "grid",
  gap: 12
};

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  fontSize: 12,
  color: "var(--muted)"
};

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--panel-edge)",
  background: "#0f120f",
  color: "var(--paper)",
  fontSize: 13,
  fontFamily: "var(--mono)"
};

const errorStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#ff6b6b",
  margin: "0 0 12px"
};
