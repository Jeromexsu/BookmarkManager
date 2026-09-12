import { useMemo, useState } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { BookmarkRow } from "./BookmarkRow";
import { ShortcutTile } from "./ShortcutTile";

interface ProjectsViewProps {
  // Resolved bookmarks of either type — a project is a container that collects references
  // and shortcuts together, not a reference-only attribute.
  bookmarks: Bookmark[];
  // Driven by the top-level omnisearch bar (App.tsx) now, not a search box owned by this view.
  query: string;
}

function buildGroups(bookmarks: Bookmark[]): Map<string, Bookmark[]> {
  const groups = new Map<string, Bookmark[]>();
  for (const b of bookmarks) {
    if (!b.project) continue;
    const list = groups.get(b.project) ?? [];
    list.push(b);
    groups.set(b.project, list);
  }
  return groups;
}

export function ProjectsView({ bookmarks, query }: ProjectsViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bookmarks;
    return bookmarks.filter((b) =>
      [b.title, b.url, b.summary, b.category, b.project, ...b.tags]
        .filter((field): field is string => Boolean(field))
        .some((field) => field.toLowerCase().includes(q))
    );
  }, [bookmarks, query]);

  const groups = buildGroups(filtered);
  const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  const isSearching = query.trim() !== "";

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Search results are a flat, unified list — the project tree adds nothing once every card
  // already shows its own project pill, so bypass it entirely while a query is active.
  const filteredReferences = filtered.filter((b) => b.type === "reference");
  const filteredShortcuts = filtered.filter((b) => b.type === "shortcut");

  return (
    <div className="flex-1 min-w-0 p-4 overflow-y-auto">
      {isSearching ? (
        filtered.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-12">No bookmarks match.</p>
        ) : (
          <div className="space-y-4">
            {filteredReferences.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">References</p>
                <ul className="space-y-2">
                  {filteredReferences.map((b) => (
                    <BookmarkRow key={b.id} bookmark={b} />
                  ))}
                </ul>
              </div>
            )}
            {filteredShortcuts.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">Shortcuts</p>
                <div className="flex flex-wrap gap-3">
                  {filteredShortcuts.map((s) => (
                    <ShortcutTile key={s.id} bookmark={s} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      ) : sortedKeys.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-12">No bookmarks have a project yet.</p>
      ) : (
        <div className="space-y-1">
          {sortedKeys.map((key) => {
            const items = groups.get(key)!;
            const isOpen = expanded.has(key);
            const references = items.filter((b) => b.type === "reference");
            const shortcuts = items.filter((b) => b.type === "shortcut");

            return (
              <div key={key}>
                <button
                  onClick={() => toggle(key)}
                  className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-900 text-left"
                >
                  <span
                    className={`text-xs text-neutral-400 transition-transform inline-block ${isOpen ? "rotate-90" : ""}`}
                  >
                    ▸
                  </span>
                  <span className="font-semibold text-sm truncate">{key}</span>
                  <span className="text-xs text-neutral-400 ml-auto">{items.length}</span>
                </button>

                {isOpen && (
                  <div className="pl-6 pb-4 space-y-4">
                    {references.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">
                          References
                        </p>
                        <ul className="space-y-2">
                          {references.map((b) => (
                            <BookmarkRow key={b.id} bookmark={b} />
                          ))}
                        </ul>
                      </div>
                    )}
                    {shortcuts.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">
                          Shortcuts
                        </p>
                        <div className="flex flex-wrap gap-3">
                          {shortcuts.map((s) => (
                            <ShortcutTile key={s.id} bookmark={s} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
