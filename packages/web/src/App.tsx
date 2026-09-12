import { useState } from "react";
import { useBookmarks, useCategories, useProjects } from "./api";
import { ReferenceView } from "./ReferenceView";
import { ShortcutView } from "./ShortcutView";
import { ProjectsView } from "./ProjectsView";
import { PendingView } from "./PendingView";

type View = "references" | "shortcuts" | "projects" | "pending";

export function App() {
  const { data: bookmarks = [], error } = useBookmarks();
  const { data: categories = [] } = useCategories();
  const { data: projects = [] } = useProjects();
  const [view, setView] = useState<View>("references");
  // Lifted out of each view (they each had their own, nearly-identical search box) — one
  // search bar, always visible regardless of which view is active, and it stays put across
  // view switches instead of resetting.
  const [query, setQuery] = useState("");

  // Unresolved (status !== "resolved") gets its own dedicated view regardless of type — most
  // arrive here because import couldn't scrape them, so we don't even know yet whether
  // they're a reference or a shortcut. Resolved items split by type as before.
  const pending = bookmarks.filter((b) => b.status !== "resolved");
  const references = bookmarks.filter((b) => b.type === "reference" && b.status === "resolved");
  const shortcuts = bookmarks.filter((b) => b.type === "shortcut");
  // A project is a container that collects references and shortcuts together, not a
  // reference-only attribute — so it draws from both, same resolved set as above.
  const resolved = [...references, ...shortcuts];

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <header className="border-b border-neutral-200 dark:border-neutral-800 px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-6">
            <h1 className="text-lg font-bold">🔖 Bookmark Manager</h1>
            <nav className="flex gap-1 bg-neutral-100 dark:bg-neutral-800 rounded-lg p-1">
              {(["references", "shortcuts", "projects", "pending"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-md transition ${
                    view === v
                      ? "bg-white dark:bg-neutral-950 shadow-sm"
                      : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                  }`}
                >
                  {v === "references"
                    ? "📄 References"
                    : v === "shortcuts"
                      ? "🔗 Shortcuts"
                      : v === "projects"
                        ? "📦 Projects"
                        : "⏳ Pending"}
                </button>
              ))}
            </nav>
          </div>
          <span className="text-xs text-neutral-400">
            {references.length} references · {shortcuts.length} shortcuts · {pending.length} pending
          </span>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search everything…"
          className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-sm outline-none focus:border-blue-500"
        />
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

      {view === "references" && <ReferenceView bookmarks={references} categories={categories} query={query} />}
      {view === "shortcuts" && <ShortcutView shortcuts={shortcuts} categories={categories} query={query} />}
      {view === "projects" && <ProjectsView bookmarks={resolved} query={query} />}
      {view === "pending" && <PendingView pending={pending} query={query} />}
    </div>
  );
}
