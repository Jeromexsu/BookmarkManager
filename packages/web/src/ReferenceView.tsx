import { useMemo, useState } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { GroupedCardView } from "./GroupedCardView";
import { BookmarkList } from "./BookmarkList";
import { CategorySuggestions } from "./CategorySuggestions";

interface ReferenceViewProps {
  bookmarks: Bookmark[];
  categories: string[];
  // Driven by the top-level omnisearch bar (App.tsx) now, not a search box owned by this view.
  query: string;
}

type SubView = "category" | "all";

export function ReferenceView({ bookmarks, categories, query }: ReferenceViewProps) {
  const [subView, setSubView] = useState<SubView>("category");

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
  const isSearching = query.trim() !== "";

  return (
    <div className="flex-1 min-w-0 p-4 overflow-y-auto">
      <nav className="flex gap-1 bg-neutral-100 dark:bg-neutral-800 rounded-lg p-1 mb-3 w-fit">
        {(["category", "all"] as const).map((v) => (
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

      {/* Search results are a flat, unified list — the category tree adds nothing once every
          card already shows its own category pill, so bypass it while a query is active
          regardless of which sub-tab is selected. */}
      {isSearching || subView === "all" ? (
        <BookmarkList bookmarks={filtered} />
      ) : (
        <GroupedCardView bookmarks={filtered} categories={categories} />
      )}
    </div>
  );
}
