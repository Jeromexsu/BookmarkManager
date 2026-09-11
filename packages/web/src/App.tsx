import { useEffect, useState, type FormEvent } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { createBookmark, listBookmarks } from "./api";

export function App() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setBookmarks(await listBookmarks());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bookmarks");
    }
  }

  useEffect(() => {
    refresh();
    // Poll so bookmarks still tagging (status: pending) pick up their tags shortly after.
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url || !title) return;
    try {
      await createBookmark({ url, title, content: content || undefined });
      setUrl("");
      setTitle("");
      setContent("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save bookmark");
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "sans-serif", padding: "0 1rem" }}>
      <h1>Bookmarks</h1>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 8, marginBottom: "2rem" }}>
        <input placeholder="URL" value={url} onChange={(e) => setUrl(e.target.value)} required />
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <textarea
          placeholder="Page content (optional — enables AI tagging)"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
        />
        <button type="submit">Save bookmark</button>
      </form>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {bookmarks.map((b) => (
          <li key={b.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            {b.favicon && (
              <img
                src={b.favicon}
                alt=""
                width={16}
                height={16}
                style={{ verticalAlign: "middle", marginRight: 6, borderRadius: 3 }}
                onError={(e) => (e.currentTarget.style.display = "none")}
              />
            )}
            <a href={b.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
              {b.title}
            </a>
            <div style={{ fontSize: 12, color: "#666" }}>{b.url}</div>
            {b.status === "pending" && <div style={{ fontSize: 12 }}>Tagging…</div>}
            {b.status === "failed" && <div style={{ fontSize: 12, color: "crimson" }}>Tagging failed</div>}
            {b.summary && <p style={{ margin: "8px 0" }}>{b.summary}</p>}
            {b.category && <span style={{ fontSize: 12, marginRight: 8 }}>📁 {b.category}</span>}
            {b.project && <span style={{ fontSize: 12, marginRight: 8 }}>📦 {b.project}</span>}
            {b.tags.map((tag) => (
              <span
                key={tag}
                style={{ fontSize: 12, background: "#eee", borderRadius: 999, padding: "2px 8px", marginRight: 4 }}
              >
                {tag}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </main>
  );
}
