import { useMemo, useState } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { GroupedCardView } from "./GroupedCardView";
import { BookmarkList } from "./BookmarkList";
import { CategorySuggestions } from "./CategorySuggestions";

interface ReferenceViewProps {
  bookmarks: Bookmark[];
  categories: string[];
}

type SubView = "category" | "project" | "all";

export function ReferenceView({ bookmarks, categories }: ReferenceViewProps) {
  const [subView, setSubView] = useState<SubView>("category");
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

  // Suggestions come back scoped to ALL uncategorized bookmarks server-side, not just the
  // current search results, so the title lookup needs the full unfiltered set too.
  const bookmarkTitleById = useMemo(() => new Map(bookmarks.map((b) => [b.id, b.title])), [bookmarks]);

  return (
    <div className="flex-1 min-w-0 p-4 overflow-y-auto">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search references…"
        className="w-full mb-3 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-sm outline-none focus:border-blue-500"
      />

      <nav className="flex gap-1 bg-neutral-100 dark:bg-neutral-800 rounded-lg p-1 mb-3 w-fit">
        {(["category", "project", "all"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setSubView(v)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md capitalize transition ${
              subView === v
                ? "bg-white dark:bg-neutral-950 shadow-sm"
                : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            {v}
          </button>
        ))}
      </nav>

      {subView === "category" && <CategorySuggestions bookmarkTitleById={bookmarkTitleById} />}

      {subView === "all" ? (
        <BookmarkList bookmarks={filtered} />
      ) : (
        <GroupedCardView bookmarks={filtered} mode={subView} autoExpand={query.trim() !== ""} categories={categories} />
      )}
    </div>
  );
}
