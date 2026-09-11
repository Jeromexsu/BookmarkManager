import { useState } from "react";
import { useBookmarks, useCategories, useProjects } from "./api";
import { ReferenceView } from "./ReferenceView";
import { ShortcutView } from "./ShortcutView";
import { PendingView } from "./PendingView";

type View = "references" | "shortcuts" | "pending";

export function App() {
  const { data: bookmarks = [], error } = useBookmarks();
  const { data: categories = [] } = useCategories();
  const { data: projects = [] } = useProjects();
  const [view, setView] = useState<View>("references");

  // Unresolved (status !== "resolved") gets its own dedicated view regardless of type — most
  // arrive here because import couldn't scrape them, so we don't even know yet whether
  // they're a reference or a shortcut. Resolved items split by type as before.
  const pending = bookmarks.filter((b) => b.status !== "resolved");
  const references = bookmarks.filter((b) => b.type === "reference" && b.status === "resolved");
  const shortcuts = bookmarks.filter((b) => b.type === "shortcut");

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <header className="border-b border-neutral-200 dark:border-neutral-800 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-bold">🔖 Bookmark Manager</h1>
          <nav className="flex gap-1 bg-neutral-100 dark:bg-neutral-800 rounded-lg p-1">
            {(["references", "shortcuts", "pending"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-md transition ${
                  view === v
                    ? "bg-white dark:bg-neutral-950 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                }`}
              >
                {v === "references" ? "📄 References" : v === "shortcuts" ? "🔗 Shortcuts" : `⏳ Pending`}
              </button>
            ))}
          </nav>
        </div>
        <span className="text-xs text-neutral-400">
          {references.length} references · {shortcuts.length} shortcuts · {pending.length} pending
        </span>
      </header>

      {error && (
        <p className="text-sm text-red-600 px-4 py-2">
          {error instanceof Error ? error.message : "Failed to load bookmarks"}
        </p>
      )}

      {/* Shared by every BookmarkRow, regardless of which top-level view rendered it. */}
      <datalist id="category-options">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="project-options">
        {projects.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      {view === "references" && <ReferenceView bookmarks={references} />}
      {view === "shortcuts" && <ShortcutView shortcuts={shortcuts} />}
      {view === "pending" && <PendingView pending={pending} />}
    </div>
  );
}
