import { useState } from "react";
import { useBookmarks, useCategories, useProjects } from "./api";
import { ReferenceView } from "./ReferenceView";
import { ShortcutView } from "./ShortcutView";

type View = "references" | "shortcuts";

export function App() {
  const { data: bookmarks = [], error } = useBookmarks();
  const { data: categories = [] } = useCategories();
  const { data: projects = [] } = useProjects();
  const [view, setView] = useState<View>("references");

  const references = bookmarks.filter((b) => b.type === "reference");
  const shortcuts = bookmarks.filter((b) => b.type === "shortcut");

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <header className="border-b border-neutral-200 dark:border-neutral-800 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-bold">🔖 Bookmark Manager</h1>
          <nav className="flex gap-1 bg-neutral-100 dark:bg-neutral-800 rounded-lg p-1">
            {(["references", "shortcuts"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-md transition ${
                  view === v
                    ? "bg-white dark:bg-neutral-950 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                }`}
              >
                {v === "references" ? "📄 References" : "🔗 Shortcuts"}
              </button>
            ))}
          </nav>
        </div>
        <span className="text-xs text-neutral-400">
          {references.length} references · {shortcuts.length} shortcuts
        </span>
      </header>

      {error && (
        <p className="text-sm text-red-600 px-4 py-2">
          {error instanceof Error ? error.message : "Failed to load bookmarks"}
        </p>
      )}

      {view === "references" ? (
        <ReferenceView bookmarks={references} categoryOptions={categories} projectOptions={projects} />
      ) : (
        <ShortcutView shortcuts={shortcuts} />
      )}
    </div>
  );
}
