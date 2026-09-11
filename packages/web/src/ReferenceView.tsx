import { useState } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { GroupedCardView } from "./GroupedCardView";
import { BookmarkList } from "./BookmarkList";
import { AddBookmarkForm } from "./AddBookmarkForm";

interface ReferenceViewProps {
  bookmarks: Bookmark[];
  categoryOptions: string[];
  projectOptions: string[];
}

type SubView = "category" | "project" | "search";

export function ReferenceView({ bookmarks, categoryOptions, projectOptions }: ReferenceViewProps) {
  const [subView, setSubView] = useState<SubView>("category");

  return (
    <div className="flex-1 min-w-0 p-4 overflow-y-auto">
      <div className="flex items-start justify-between mb-3 gap-4">
        <nav className="flex gap-1 bg-neutral-100 dark:bg-neutral-800 rounded-lg p-1">
          {(["category", "project", "search"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setSubView(v)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-md transition ${
                subView === v
                  ? "bg-white dark:bg-neutral-950 shadow-sm"
                  : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
              }`}
            >
              {v === "category" ? "📁 Category" : v === "project" ? "📦 Project" : "🔍 Search"}
            </button>
          ))}
        </nav>
        <AddBookmarkForm />
      </div>

      {/* Shared by every BookmarkRow, regardless of which sub-view rendered it. */}
      <datalist id="category-options">
        {categoryOptions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="project-options">
        {projectOptions.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      {subView === "search" ? <BookmarkList bookmarks={bookmarks} /> : <GroupedCardView bookmarks={bookmarks} mode={subView} />}
    </div>
  );
}
