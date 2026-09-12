import type { Bookmark } from "@bookmark-manager/shared";
import { PendingRow } from "./PendingRow";

interface PendingViewProps {
  pending: Bookmark[];
}

export function PendingView({ pending }: PendingViewProps) {
  return (
    <div className="flex-1 min-w-0 p-4 overflow-y-auto">
      <p className="text-sm text-neutral-500 mb-3">
        {pending.length} bookmark{pending.length === 1 ? "" : "s"} we couldn't auto-extract content for. There's
        nothing to tag or categorize without content — delete it, or reopen it and re-add it so it gets fetched
        properly.
      </p>

      {pending.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-12">Nothing pending — you're all caught up.</p>
      ) : (
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {pending.map((b) => (
            <PendingRow key={b.id} bookmark={b} />
          ))}
        </ul>
      )}
    </div>
  );
}
