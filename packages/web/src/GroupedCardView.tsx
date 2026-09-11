import { useState } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { BookmarkRow } from "./BookmarkRow";

export type GroupMode = "category" | "project";

interface GroupedCardViewProps {
  bookmarks: Bookmark[];
  mode: GroupMode;
}

// Category groups every bookmark (with an "Uncategorized" bucket); project only counts
// bookmarks that have one — same convention as the extension's popup.ts buildGroups.
function buildGroups(bookmarks: Bookmark[], mode: GroupMode): Map<string, Bookmark[]> {
  const groups = new Map<string, Bookmark[]>();
  const relevant = mode === "project" ? bookmarks.filter((b) => b.project) : bookmarks;

  for (const b of relevant) {
    const key = mode === "project" ? b.project! : (b.category ?? "Uncategorized");
    const list = groups.get(key) ?? [];
    list.push(b);
    groups.set(key, list);
  }
  return groups;
}

export function GroupedCardView({ bookmarks, mode }: GroupedCardViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const groups = buildGroups(bookmarks, mode);
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
    return (
      <p className="text-sm text-neutral-400 text-center py-12">
        {mode === "project" ? "No bookmarks have a project yet." : "No bookmarks yet."}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {sortedKeys.map((key) => {
        const items = groups.get(key)!;
        const isOpen = expanded.has(key);
        return (
          <div key={key}>
            <button
              onClick={() => toggle(key)}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-900 text-left"
            >
              <span className={`text-xs text-neutral-400 transition-transform inline-block ${isOpen ? "rotate-90" : ""}`}>
                ▸
              </span>
              <span className="font-semibold text-sm">
                {mode === "project" ? "📦" : "📁"} {key}
              </span>
              <span className="text-xs text-neutral-400 ml-auto">{items.length}</span>
            </button>
            {isOpen && (
              <ul className="space-y-2 pl-6 pb-3">
                {items.map((b) => (
                  <BookmarkRow key={b.id} bookmark={b} />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
