import { useMemo, useState } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { BookmarkRow } from "./BookmarkRow";
import { AddBookmarkForm } from "./AddBookmarkForm";

interface BookmarkListProps {
  bookmarks: Bookmark[];
  categoryOptions: string[];
  projectOptions: string[];
}

export function BookmarkList({ bookmarks, categoryOptions, projectOptions }: BookmarkListProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bookmarks;
    return bookmarks.filter((b) =>
      [b.title, b.url, b.summary, b.category, b.project, ...b.tags]
        .filter((field): field is string => Boolean(field))
        .some((field) => field.toLowerCase().includes(q))
    );
  }, [bookmarks, query]);

  return (
    <div className="flex-1 min-w-0 p-4 overflow-y-auto">
      <div className="mb-4">
        <AddBookmarkForm />
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search bookmarks…"
        className="w-full mb-4 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-sm outline-none focus:border-blue-500"
      />

      <datalist id="category-options">
        {categoryOptions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="project-options">
        {projectOptions.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      {filtered.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-12">No bookmarks match.</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((b) => (
            <BookmarkRow key={b.id} bookmark={b} />
          ))}
        </ul>
      )}
    </div>
  );
}
