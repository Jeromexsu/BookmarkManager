import { useState } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { BookmarkRow } from "./BookmarkRow";
import { ShortcutTile } from "./ShortcutTile";

interface ProjectsViewProps {
  // Resolved bookmarks of either type — a project is a container that collects references
  // and shortcuts together, not a reference-only attribute.
  bookmarks: Bookmark[];
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

export function ProjectsView({ bookmarks }: ProjectsViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const groups = buildGroups(bookmarks);
  const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="flex-1 min-w-0 p-4 overflow-y-auto">
      {sortedKeys.length === 0 ? (
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
