"use client";

import { useState } from "react";

export default function Page() {
  const [url, setUrl] = useState("");
  const [limit, setLimit] = useState(50);
  const [cookie, setCookie] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, limit, cookie: cookie.trim() || undefined })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed: ${res.status}`);
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "pinterest-top-images.zip";
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(a.href);
      a.remove();
    } catch (err: any) {
      setError(err?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>Pinterest Top Images Downloader</h1>
      <p style={{ color: '#9ca3af', marginBottom: 24 }}>
        Paste a Pinterest board or search URL. Optionally add your Pinterest cookie string if needed for access. The most-liked pins will be zipped.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
        <label style={{ display: 'grid', gap: 8 }}>
          <span>Pinterest URL</span>
          <input
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.pinterest.com/USERNAME/BOARD/ or search URL"
            style={{ padding: '12px 14px', borderRadius: 10, background: '#111827', border: '1px solid #1f2937', color: 'white' }}
          />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <label style={{ display: 'grid', gap: 8 }}>
            <span>Max images</span>
            <input
              type="number"
              min={1}
              max={400}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              style={{ padding: '12px 14px', borderRadius: 10, background: '#111827', border: '1px solid #1f2937', color: 'white' }}
            />
          </label>

          <label style={{ display: 'grid', gap: 8 }}>
            <span>Pinterest Cookie (optional)</span>
            <input
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              placeholder="name=value; name2=value2"
              style={{ padding: '12px 14px', borderRadius: 10, background: '#111827', border: '1px solid #1f2937', color: 'white' }}
            />
          </label>
        </div>

        <button type="submit" disabled={loading} style={{
          background: loading ? '#374151' : '#2563eb',
          border: '1px solid #1d4ed8',
          borderRadius: 10,
          padding: '12px 16px',
          color: 'white',
          fontWeight: 600
        }}>
          {loading ? 'Working?' : 'Find & Download'}
        </button>
      </form>

      {error && (
        <div style={{ marginTop: 16, color: '#ef4444' }}>{error}</div>
      )}

      <div style={{ marginTop: 24, color: '#9ca3af', fontSize: 13 }}>
        Tip: Public boards often work without cookies. For private or gated content, paste the cookie string from your Pinterest browser session.
      </div>
    </div>
  );
}
