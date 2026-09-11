import { useState } from "react";
import { useBookmarks, useCategories, useProjects } from "./api";
import { Sidebar, type GroupMode } from "./Sidebar";
import { BookmarkList } from "./BookmarkList";

export function App() {
  const { data: bookmarks = [], error } = useBookmarks();
  const { data: categories = [] } = useCategories();
  const { data: projects = [] } = useProjects();
  const [groupMode, setGroupMode] = useState<GroupMode>("category");
  const [selected, setSelected] = useState<string | null>(null);

  const scoped =
    selected === null
      ? bookmarks
      : bookmarks.filter((b) =>
          groupMode === "project" ? b.project === selected : (b.category ?? "Uncategorized") === selected
        );

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <header className="border-b border-neutral-200 dark:border-neutral-800 px-4 py-3 flex items-center justify-between shrink-0">
        <h1 className="text-lg font-bold">🔖 Bookmark Manager</h1>
        <span className="text-xs text-neutral-400">{bookmarks.length} bookmarks</span>
      </header>

      {error && (
        <p className="text-sm text-red-600 px-4 py-2">
          {error instanceof Error ? error.message : "Failed to load bookmarks"}
        </p>
      )}

      <div className="flex flex-1 min-h-0">
        <Sidebar
          bookmarks={bookmarks}
          mode={groupMode}
          onModeChange={(mode) => {
            setGroupMode(mode);
            setSelected(null);
          }}
          selected={selected}
          onSelect={setSelected}
        />
        <BookmarkList bookmarks={scoped} categoryOptions={categories} projectOptions={projects} />
      </div>
    </div>
  );
}
