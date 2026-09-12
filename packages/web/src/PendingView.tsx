import type { Bookmark } from "@bookmark-manager/shared";
import { BookmarkRow } from "./BookmarkRow";

interface PendingViewProps {
  pending: Bookmark[];
}

export function PendingView({ pending }: PendingViewProps) {
  return (
    <div className="flex-1 min-w-0 p-4 overflow-y-auto">
      <p className="text-sm text-neutral-500 mb-3">
        {pending.length} bookmark{pending.length === 1 ? "" : "s"} we couldn't auto-extract content for, so their type,
        tags, and summary are still unknown. Add tags/category by hand, mark it as a shortcut if it's just an
        entrance page, or mark it resolved as-is if it doesn't need any of that.
      </p>

      {pending.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-12">Nothing pending — you're all caught up.</p>
      ) : (
        <ul className="space-y-2">
          {pending.map((b) => (
            <BookmarkRow key={b.id} bookmark={b} showResolveActions />
          ))}
        </ul>
      )}
    </div>
  );
}
