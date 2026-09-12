import { useMemo } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { BookmarkRow } from "./BookmarkRow";
import { ShortcutTile } from "./ShortcutTile";

interface SearchResultsViewProps {
  // The full, unfiltered set — every type and status — since this is what makes the search bar
  // an actual omnisearch: it doesn't matter which tab you were on, a match anywhere shows up.
  bookmarks: Bookmark[];
  query: string;
}

export function SearchResultsView({ bookmarks, query }: SearchResultsViewProps) {
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return bookmarks.filter((b) =>
      [b.title, b.url, b.summary, b.category, b.project, ...b.tags]
        .filter((field): field is string => Boolean(field))
        .some((field) => field.toLowerCase().includes(q))
    );
  }, [bookmarks, query]);

  const pending = matches.filter((b) => b.status !== "resolved");
  const references = matches.filter((b) => b.type === "reference" && b.status === "resolved");
  const shortcuts = matches.filter((b) => b.type === "shortcut");

  return (
    <div className="flex-1 min-w-0 p-4 overflow-y-auto">
      <p className="text-sm text-neutral-500 mb-3">
        {matches.length} result{matches.length === 1 ? "" : "s"} for "{query}"
      </p>

      {matches.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-12">No bookmarks match.</p>
      ) : (
        <div className="space-y-4">
          {/* References and shortcuts aren't separately labeled — a card vs. a tile already
              tells them apart, same as a category pill already tells you a card's category.
              Pending gets a real label since it renders the same card shape as references. */}
          {(references.length > 0 || shortcuts.length > 0) && (
            <div className="space-y-3">
              {shortcuts.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {shortcuts.map((s) => (
                    <ShortcutTile key={s.id} bookmark={s} />
                  ))}
                </div>
              )}
              {references.length > 0 && (
                <ul className="space-y-2">
                  {references.map((b) => (
                    <BookmarkRow key={b.id} bookmark={b} />
                  ))}
                </ul>
              )}
            </div>
          )}
          {pending.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">Pending</p>
              <ul className="space-y-2">
                {pending.map((b) => (
                  <BookmarkRow key={b.id} bookmark={b} showResolveActions />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
