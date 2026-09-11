import type { Bookmark } from "@bookmark-manager/shared";

export type GroupMode = "category" | "project";

interface SidebarProps {
  bookmarks: Bookmark[];
  mode: GroupMode;
  onModeChange: (mode: GroupMode) => void;
  selected: string | null;
  onSelect: (name: string | null) => void;
}

// Mirrors the extension popup's buildGroups (src/popup/popup.ts): category groups every
// bookmark (with an "Uncategorized" bucket), project only counts bookmarks that have one.
function buildCounts(bookmarks: Bookmark[], mode: GroupMode): Map<string, number> {
  const counts = new Map<string, number>();
  const relevant = mode === "project" ? bookmarks.filter((b) => b.project) : bookmarks;

  for (const b of relevant) {
    const key = mode === "project" ? b.project! : (b.category ?? "Uncategorized");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function Sidebar({ bookmarks, mode, onModeChange, selected, onSelect }: SidebarProps) {
  const counts = buildCounts(bookmarks, mode);
  const sortedKeys = [...counts.keys()].sort((a, b) => {
    if (a === "Uncategorized") return 1;
    if (b === "Uncategorized") return -1;
    return a.localeCompare(b);
  });

  return (
    <aside className="w-64 shrink-0 border-r border-neutral-200 dark:border-neutral-800 p-3 overflow-y-auto">
      <div className="flex gap-1 bg-neutral-100 dark:bg-neutral-800 rounded-lg p-1 mb-3">
        {(["category", "project"] as const).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            className={`flex-1 text-xs font-semibold py-1.5 rounded-md transition ${
              mode === m
                ? "bg-white dark:bg-neutral-950 shadow-sm text-neutral-900 dark:text-neutral-100"
                : "text-neutral-500"
            }`}
          >
            {m === "category" ? "📁 Categories" : "📦 Projects"}
          </button>
        ))}
      </div>

      <button
        onClick={() => onSelect(null)}
        className={`w-full text-left text-sm font-medium px-2 py-1.5 rounded-md mb-1 flex items-center justify-between ${
          selected === null
            ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
            : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
        }`}
      >
        <span>All bookmarks</span>
        <span className="text-neutral-400 text-xs">{bookmarks.length}</span>
      </button>

      {sortedKeys.map((key) => (
        <button
          key={key}
          onClick={() => onSelect(key)}
          className={`w-full text-left text-sm px-2 py-1.5 rounded-md mb-0.5 flex items-center justify-between ${
            selected === key
              ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
              : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
          }`}
        >
          <span className="truncate">
            {mode === "project" ? "📦" : "📁"} {key}
          </span>
          <span className="text-neutral-400 text-xs shrink-0 ml-2">{counts.get(key)}</span>
        </button>
      ))}
    </aside>
  );
}
