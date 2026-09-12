import type { Bookmark } from "@bookmark-manager/shared";
import { BookmarkRow } from "./BookmarkRow";

interface BookmarkListProps {
  bookmarks: Bookmark[];
}

export function BookmarkList({ bookmarks }: BookmarkListProps) {
  if (bookmarks.length === 0) {
    return <p className="text-sm text-neutral-400 text-center py-12">No bookmarks match.</p>;
  }

  return (
    <ul className="space-y-3">
      {bookmarks.map((b) => (
        <BookmarkRow key={b.id} bookmark={b} />
      ))}
    </ul>
  );
}
