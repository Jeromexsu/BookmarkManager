import { useState } from "react";
import type { Bookmark, ShortcutCandidate } from "@bookmark-manager/shared";
import { useConfirmShortcuts, useDetectShortcuts, useUpdateBookmark } from "./api";
import { Favicon } from "./Favicon";

interface ShortcutViewProps {
  shortcuts: Bookmark[];
}

export function ShortcutView({ shortcuts }: ShortcutViewProps) {
  const detectMutation = useDetectShortcuts();
  const confirmMutation = useConfirmShortcuts();
  const updateMutation = useUpdateBookmark();
  const [candidates, setCandidates] = useState<ShortcutCandidate[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  async function handleDetect() {
    const result = await detectMutation.mutateAsync();
    setCandidates(result);
    setChecked(new Set(result.map((c) => c.id)));
  }

  function toggle(id: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConfirm() {
    if (checked.size === 0) return;
    await confirmMutation.mutateAsync([...checked]);
    setCandidates(null);
    setChecked(new Set());
  }

  function handleRevert(id: number) {
    updateMutation.mutate({ id, patch: { type: "reference" } });
  }

  return (
    <div className="flex-1 min-w-0 p-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-neutral-500">{shortcuts.length} shortcuts</h2>
        <button
          onClick={handleDetect}
          disabled={detectMutation.isPending}
          className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
        >
          {detectMutation.isPending ? "Scanning…" : "✨ Detect shortcuts"}
        </button>
      </div>

      {candidates && (
        <div className="mb-6 border border-neutral-200 dark:border-neutral-800 rounded-lg p-3">
          <p className="text-sm font-medium mb-2">
            Found {candidates.length} candidate{candidates.length === 1 ? "" : "s"} — review and confirm:
          </p>
          {candidates.length === 0 ? (
            <p className="text-sm text-neutral-400">No new shortcuts found.</p>
          ) : (
            <ul className="space-y-1 max-h-80 overflow-y-auto mb-3">
              {candidates.map((c) => (
                <li key={c.id} className="flex items-start gap-2 text-sm py-1">
                  <input type="checkbox" checked={checked.has(c.id)} onChange={() => toggle(c.id)} className="mt-1" />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.title}</div>
                    <div className="text-xs text-neutral-500 truncate">{c.url}</div>
                    <div className="text-xs text-neutral-400 italic">{c.reason}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            {candidates.length > 0 && (
              <button
                onClick={handleConfirm}
                disabled={checked.size === 0 || confirmMutation.isPending}
                className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                Add {checked.size} shortcut{checked.size === 1 ? "" : "s"}
              </button>
            )}
            <button
              onClick={() => setCandidates(null)}
              className="px-3 py-1.5 rounded-md text-sm text-neutral-500 hover:text-neutral-700"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {shortcuts.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-12">
          No shortcuts yet — click "Detect shortcuts" to find candidates among your bookmarks.
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {shortcuts.map((s) => (
            <a
              key={s.id}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="group relative w-24 flex flex-col items-center gap-1.5 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
            >
              <button
                onClick={(e) => {
                  e.preventDefault();
                  handleRevert(s.id);
                }}
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-600 text-xs"
                title="Not a shortcut"
              >
                ×
              </button>
              <Favicon favicon={s.favicon} title={s.title} size="md" />
              <span className="text-xs text-center truncate w-full">{s.title}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
