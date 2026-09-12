import { useMemo, useState } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { BookmarkRow } from "./BookmarkRow";
import { Favicon } from "./Favicon";

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
  const [query, setQuery] = useState("");
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
  const autoExpand = query.trim() !== "";

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
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search projects…"
        className="w-full mb-3 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-sm outline-none focus:border-blue-500"
      />

      {sortedKeys.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-12">
          {bookmarks.length === 0 ? "No bookmarks have a project yet." : "No projects match."}
        </p>
      ) : (
        <div className="space-y-1">
          {sortedKeys.map((key) => {
            const items = groups.get(key)!;
            const isOpen = autoExpand || expanded.has(key);
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
                            <a
                              key={s.id}
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              className="w-24 flex flex-col items-center gap-1.5 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                            >
                              <Favicon favicon={s.favicon} title={s.title} size="md" />
                              <span className="text-xs text-center truncate w-full">{s.title}</span>
                            </a>
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
