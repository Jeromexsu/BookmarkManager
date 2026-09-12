import { useMemo, useState } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { GroupedCardView } from "./GroupedCardView";
import { BookmarkList } from "./BookmarkList";
import { CategorySuggestions } from "./CategorySuggestions";
import { useCategoriesFull } from "./api";

interface ReferenceViewProps {
  bookmarks: Bookmark[];
  categories: string[];
}

type SubView = "category" | "all";

export function ReferenceView({ bookmarks, categories }: ReferenceViewProps) {
  const [subView, setSubView] = useState<SubView>("category");
  const { data: categoriesFull = [] } = useCategoriesFull();
  const categoryDescriptions = useMemo(
    () => new Map(categoriesFull.map((c) => [c.name, c.description])),
    [categoriesFull]
  );

  // Used for the Auto-categorize review panel's title lookup — assignments come back as bare
  // ids scoped server-side, not tied to anything shown in this view directly.
  const bookmarkTitleById = useMemo(() => new Map(bookmarks.map((b) => [b.id, b.title])), [bookmarks]);

  return (
    <div className="flex-1 min-w-0 p-4 overflow-y-auto">
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <nav className="flex gap-1 bg-neutral-100 dark:bg-neutral-800 rounded-lg p-1 w-fit shrink-0">
          {(["category", "all"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setSubView(v)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-md capitalize transition ${
                subView === v
                  ? "bg-white dark:bg-neutral-950 shadow-sm"
                  : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
              }`}
            >
              {v}
            </button>
          ))}
        </nav>

        {subView === "category" && <CategorySuggestions type="reference" bookmarkTitleById={bookmarkTitleById} />}
      </div>

      {subView === "all" ? (
        <BookmarkList bookmarks={bookmarks} />
      ) : (
        <GroupedCardView bookmarks={bookmarks} categories={categories} categoryDescriptions={categoryDescriptions} />
      )}
    </div>
  );
}
