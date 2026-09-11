import { useMemo, useState } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { BookmarkRow } from "./BookmarkRow";

interface PendingViewProps {
  pending: Bookmark[];
}

export function PendingView({ pending }: PendingViewProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pending;
    return pending.filter((b) => [b.title, b.url].some((field) => field.toLowerCase().includes(q)));
  }, [pending, query]);

  return (
    <div className="flex-1 min-w-0 p-4 overflow-y-auto">
      <p className="text-sm text-neutral-500 mb-3">
        {pending.length} bookmark{pending.length === 1 ? "" : "s"} we couldn't auto-extract content for, so their type,
        tags, and summary are still unknown. Add tags/category by hand, mark it as a shortcut if it's just an
        entrance page, or mark it resolved as-is if it doesn't need any of that.
      </p>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search pending…"
        className="w-full mb-4 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-sm outline-none focus:border-blue-500"
      />

      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-12">
          {pending.length === 0 ? "Nothing pending — you're all caught up." : "No pending bookmarks match."}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((b) => (
            <BookmarkRow key={b.id} bookmark={b} showResolveActions />
          ))}
        </ul>
      )}
    </div>
  );
}
