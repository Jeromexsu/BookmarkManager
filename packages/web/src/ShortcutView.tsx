import { useEffect, useMemo, useState } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { useClearShortcutCache, useConfirmShortcuts, useDetectShortcutsJob, useStartDetectShortcuts } from "./api";
import { GroupedCardView } from "./GroupedCardView";
import { ShortcutTile } from "./ShortcutTile";

// Persisted (not component state) so a detection run survives a tab switch, reload, or closing
// and reopening the page — same reasoning as CategorySuggestions' STORAGE_KEY.
const STORAGE_KEY = "detectShortcutsJobId";

function readStoredJobId(): number | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

type SubView = "category" | "all";

interface ShortcutViewProps {
  shortcuts: Bookmark[];
  categories: string[];
}

export function ShortcutView({ shortcuts, categories }: ShortcutViewProps) {
  const startMutation = useStartDetectShortcuts();
  const confirmMutation = useConfirmShortcuts();
  const clearCacheMutation = useClearShortcutCache();

  const [subView, setSubView] = useState<SubView>("category");
  const [query, setQuery] = useState("");
  const [jobId, setJobId] = useState<number | null>(readStoredJobId);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const jobQuery = useDetectShortcutsJob(jobId);
  const isRunning = jobId !== null && jobQuery.data?.status !== "completed" && jobQuery.data?.status !== "failed";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shortcuts;
    return shortcuts.filter((b) =>
      [b.title, b.url, b.category, b.project, ...b.tags]
        .filter((field): field is string => Boolean(field))
        .some((field) => field.toLowerCase().includes(q))
    );
  }, [shortcuts, query]);

  // Anchored to the job's real createdAt, not this component's mount time, so reopening the
  // page after a while shows true elapsed time rather than restarting from zero.
  useEffect(() => {
    const createdAt = jobQuery.data?.createdAt;
    if (!isRunning || !createdAt) {
      setElapsedSeconds(0);
      return;
    }
    const start = new Date(createdAt).getTime();
    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isRunning, jobQuery.data?.createdAt]);

  // Default every candidate to checked, same as before this was a job — the user unchecks the
  // ones they don't want rather than hand-picking from scratch. Fires once per job reaching
  // "completed" (on the transition, and on mount if resuming an already-finished job), not on
  // every re-render, so it doesn't clobber unchecks the user already made.
  useEffect(() => {
    if (jobQuery.data?.status === "completed" && jobQuery.data.candidates) {
      setChecked(new Set(jobQuery.data.candidates.map((c) => c.id)));
    }
  }, [jobId, jobQuery.data?.status]);

  async function handleDetect() {
    const newJobId = await startMutation.mutateAsync();
    localStorage.setItem(STORAGE_KEY, String(newJobId));
    setChecked(new Set());
    setJobId(newJobId);
  }

  function dismiss() {
    localStorage.removeItem(STORAGE_KEY);
    setJobId(null);
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
    dismiss();
  }

  const candidates = jobQuery.data?.status === "completed" ? jobQuery.data.candidates : null;

  return (
    <div className="flex-1 min-w-0 p-4 overflow-y-auto">
      <div className="flex items-center gap-2 mb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search shortcuts…"
          className="flex-1 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-sm outline-none focus:border-blue-500"
        />
        <button
          onClick={() => clearCacheMutation.mutate()}
          disabled={clearCacheMutation.isPending}
          title="Forget which reference bookmarks were already ruled out, so the next scan reconsiders everything"
          className="shrink-0 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 text-xs font-medium text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50"
        >
          {clearCacheMutation.isPending ? "Clearing…" : "Clear scan cache"}
        </button>
        {jobId === null && (
          <button
            onClick={handleDetect}
            disabled={startMutation.isPending}
            className="shrink-0 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50"
          >
            Detect shortcuts
          </button>
        )}
      </div>

      <nav className="flex gap-1 bg-neutral-100 dark:bg-neutral-800 rounded-lg p-1 mb-3 w-fit">
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

      {clearCacheMutation.isSuccess && (
        <p className="text-xs text-neutral-400 mb-4">
          Cleared {clearCacheMutation.data} bookmark{clearCacheMutation.data === 1 ? "" : "s"} from the scan cache —
          they'll be reconsidered on the next scan.
        </p>
      )}
      {clearCacheMutation.isError && <p className="text-xs text-red-600 mb-4">Couldn't clear the scan cache.</p>}

      {startMutation.isError && <p className="text-xs text-red-600 mb-4">Couldn't start shortcut detection.</p>}

      {isRunning && (
        <div className="mb-6 border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 flex items-center gap-3 flex-wrap">
          <p className="text-sm font-medium">Scanning for shortcuts… {elapsedSeconds}s</p>
          <p className="text-xs text-neutral-400">
            Only bookmarks not already ruled out get (re-)checked. Feel free to switch tabs or come back later; the
            result will be waiting here.
          </p>
          <button
            onClick={dismiss}
            className="ml-auto px-3 py-1 rounded-md text-xs font-medium text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Hide
          </button>
        </div>
      )}

      {jobQuery.data?.status === "failed" && (
        <div className="mb-6 border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 flex items-center justify-between gap-3">
          <p className="text-sm text-red-600">Couldn't detect shortcuts: {jobQuery.data.error ?? "unknown error"}</p>
          <button
            onClick={dismiss}
            className="shrink-0 px-3 py-1 rounded-md text-xs font-medium text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Dismiss
          </button>
        </div>
      )}

      {candidates && (
        <div className="mb-6 border border-neutral-200 dark:border-neutral-800 rounded-lg p-3">
          <p className="text-sm font-medium mb-2">
            {candidates.length === 0
              ? "No new shortcuts found."
              : `Found ${candidates.length} candidate${candidates.length === 1 ? "" : "s"} — review and confirm:`}
          </p>
          {candidates.length > 0 && (
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
            <button onClick={dismiss} className="px-3 py-1.5 rounded-md text-sm text-neutral-500 hover:text-neutral-700">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {shortcuts.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-12">
          No shortcuts yet — click "Detect shortcuts" to find candidates among your bookmarks.
        </p>
      ) : subView === "all" ? (
        <div className="flex flex-wrap gap-3">
          {filtered.map((s) => (
            <ShortcutTile key={s.id} bookmark={s} />
          ))}
        </div>
      ) : (
        <GroupedCardView
          bookmarks={filtered}
          autoExpand={query.trim() !== ""}
          categories={categories}
          renderItems={(items, moveToCategories) => (
            <div className="flex flex-wrap gap-3 pl-6 pb-3">
              {items.map((s) => (
                <ShortcutTile key={s.id} bookmark={s} moveToCategories={moveToCategories} />
              ))}
            </div>
          )}
        />
      )}
    </div>
  );
}
