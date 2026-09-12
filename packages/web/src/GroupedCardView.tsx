import { useState, type ReactNode } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { BookmarkRow } from "./BookmarkRow";
import { useDeleteCategory, useRenameCategory } from "./api";

interface GroupedCardViewProps {
  bookmarks: Bookmark[];
  // While searching, every group with a match should just be visible — the user shouldn't
  // have to expand each one by hand to see what matched.
  autoExpand?: boolean;
  // Full category name list (unaffected by search/grouping) — used for the per-bookmark
  // "Move to" dropdown and to know what a rename would collide/merge with.
  categories?: string[];
  // Defaults to a BookmarkRow list (References' shape). ShortcutView passes its own grid of
  // ShortcutTile instead — the grouping/rename/remove/expand behavior above is identical either
  // way, only how a group's items actually render differs.
  renderItems?: (items: Bookmark[], moveToCategories: string[]) => ReactNode;
}

function defaultRenderItems(items: Bookmark[], moveToCategories: string[]): ReactNode {
  return (
    <ul className="space-y-2 pl-6 pb-3">
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
  renderItems = defaultRenderItems,
}: GroupedCardViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameMutation = useRenameCategory();
  const deleteMutation = useDeleteCategory();

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

  function startRename(key: string) {
    setRenamingKey(key);
    setRenameDraft(key);
  }

  function commitRename(key: string) {
    const to = renameDraft.trim();
    setRenamingKey(null);
    if (to && to !== key) {
      renameMutation.mutate({ from: key, to });
    }
  }

  function handleDeleteCategory(key: string, count: number) {
    if (confirm(`Remove category "${key}"? Its ${count} bookmark${count === 1 ? "" : "s"} will become Uncategorized.`)) {
      deleteMutation.mutate(key);
    }
  }

  if (sortedKeys.length === 0) {
    return <p className="text-sm text-neutral-400 text-center py-12">No bookmarks yet.</p>;
  }

  return (
    <div className="space-y-1">
      {sortedKeys.map((key) => {
        const items = groups.get(key)!;
        const isOpen = autoExpand || expanded.has(key);
        const isManageable = key !== "Uncategorized";
        const isRenaming = renamingKey === key;
        const moveToCategories = categories?.filter((c) => c !== key) ?? [];

        return (
          <div key={key}>
            <div className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-900">
              <button
                onClick={() => toggle(key)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
              >
                <span className={`text-xs text-neutral-400 transition-transform inline-block ${isOpen ? "rotate-90" : ""}`}>
                  ▸
                </span>
                {isRenaming ? (
                  <input
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(key);
                      if (e.key === "Escape") setRenamingKey(null);
                    }}
                    onBlur={() => commitRename(key)}
                    className="font-semibold text-sm px-1.5 py-0.5 rounded border border-blue-400 outline-none bg-white dark:bg-neutral-950"
                  />
                ) : (
                  <span className="font-semibold text-sm truncate">{key}</span>
                )}
                <span className="text-xs text-neutral-400">{items.length}</span>
              </button>

              {isManageable && !isRenaming && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => startRename(key)}
                    className="text-xs px-2 py-1 rounded-md text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    Rename
                  </button>
                  <button
                    onClick={() => handleDeleteCategory(key, items.length)}
                    className="text-xs px-2 py-1 rounded-md text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
            {isOpen && renderItems(items, moveToCategories)}
          </div>
        );
      })}
    </div>
  );
}
