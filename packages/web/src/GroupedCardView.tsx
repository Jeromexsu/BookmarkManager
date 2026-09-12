import { useState, type ReactNode } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { BookmarkRow } from "./BookmarkRow";

interface GroupedCardViewProps {
  bookmarks: Bookmark[];
  // While searching, every group with a match should just be visible — the user shouldn't
  // have to expand each one by hand to see what matched.
  autoExpand?: boolean;
  // Full category name list (unaffected by search/grouping) — used for the per-bookmark
  // "Move to" dropdown and to know what a rename would collide/merge with.
  categories?: string[];
  // Name -> description, so each group header can show what the category is actually for.
  categoryDescriptions?: Map<string, string | null>;
  // Defaults to a BookmarkRow list (References' shape). ShortcutView passes its own grid of
  // ShortcutTile instead — the grouping/rename/remove/expand behavior above is identical either
  // way, only how a group's items actually render differs.
  renderItems?: (items: Bookmark[], moveToCategories: string[]) => ReactNode;
}

function defaultRenderItems(items: Bookmark[], moveToCategories: string[]): ReactNode {
  return (
    <ul className="space-y-3 pl-6 pt-2 pb-3">
      {items.map((b) => (
        <BookmarkRow key={b.id} bookmark={b} moveToCategories={moveToCategories} />
      ))}
    </ul>
  );
}

function buildGroups(bookmarks: Bookmark[]): Map<string, Bookmark[]> {
  const groups = new Map<string, Bookmark[]>();
  for (const b of bookmarks) {
    const key = b.category ?? "Uncategorized";
    const list = groups.get(key) ?? [];
    list.push(b);
    groups.set(key, list);
  }
  return groups;
}

export function GroupedCardView({
  bookmarks,
  autoExpand = false,
  categories,
  categoryDescriptions,
  renderItems = defaultRenderItems,
}: GroupedCardViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const groups = buildGroups(bookmarks);
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    if (a === "Uncategorized") return 1;
    if (b === "Uncategorized") return -1;
    return a.localeCompare(b);
  });

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (sortedKeys.length === 0) {
    return <p className="text-sm text-neutral-400 text-center py-12">No bookmarks yet.</p>;
  }

  return (
    <div className="space-y-1">
      {sortedKeys.map((key) => {
        const items = groups.get(key)!;
        const isOpen = autoExpand || expanded.has(key);
        const moveToCategories = categories?.filter((c) => c !== key) ?? [];

        return (
          <div key={key}>
            <button
              onClick={() => toggle(key)}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-900 text-left"
            >
              <span
                className={`shrink-0 text-xs text-neutral-400 transition-transform inline-block ${isOpen ? "rotate-90" : ""}`}
              >
                ▸
              </span>
              <span className="shrink-0 font-semibold text-sm">{key}</span>
              {categoryDescriptions?.get(key) && (
                <span className="min-w-0 flex-1 truncate text-xs text-neutral-400">{categoryDescriptions.get(key)}</span>
              )}
              <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {items.length}
              </span>
            </button>

            {isOpen && renderItems(items, moveToCategories)}
          </div>
        );
      })}
    </div>
  );
}
