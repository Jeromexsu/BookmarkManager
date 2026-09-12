import type { Bookmark } from "@bookmark-manager/shared";
import { useDeleteBookmark } from "./api";
import { Favicon } from "./Favicon";

interface PendingRowProps {
  bookmark: Bookmark;
}

// Deliberately minimal — a pending bookmark has no scraped content, so there's nothing here to
// tag/categorize/summarize by hand. The only two sane moves are: delete it, or reopen the URL
// (the title link) and re-add it through the normal save flow so it gets picked up properly.
export function PendingRow({ bookmark }: PendingRowProps) {
  const deleteMutation = useDeleteBookmark();

  function handleDelete() {
    if (confirm(`Delete "${bookmark.title}"?`)) {
      deleteMutation.mutate(bookmark.id);
    }
  }

  return (
    <li
      className="border border-neutral-200 dark:border-neutral-800 rounded-lg px-2.5 py-2 flex items-center gap-2"
      title={bookmark.status === "failed" ? "Couldn't fetch this page — reopen it and re-add it by hand." : undefined}
    >
      <Favicon favicon={bookmark.favicon} title={bookmark.title} size="sm" />
      <div className="min-w-0 flex-1">
        <a href={bookmark.url} target="_blank" rel="noreferrer" className="font-semibold text-sm hover:underline truncate block">
          {bookmark.status === "failed" && <span className="text-red-600 mr-1">⚠</span>}
          {bookmark.title}
        </a>
        <div className="text-xs text-neutral-500 truncate">{bookmark.url}</div>
      </div>
      <button onClick={handleDelete} className="shrink-0 text-neutral-400 hover:text-red-600 text-xs">
        Delete
      </button>
    </li>
  );
}
