import { useEffect, useMemo, useState } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import {
  useCategoriesFull,
  useClearShortcutCache,
  useConfirmShortcuts,
  useDetectShortcutsJob,
  useStartDetectShortcuts,
} from "./api";
import { GroupedCardView } from "./GroupedCardView";
import { ShortcutTile } from "./ShortcutTile";
import { CategorySuggestions } from "./CategorySuggestions";

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
  const [jobId, setJobId] = useState<number | null>(readStoredJobId);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const { data: categoriesFull = [] } = useCategoriesFull();
  const categoryDescriptions = useMemo(
    () => new Map(categoriesFull.map((c) => [c.name, c.description])),
    [categoriesFull]
  );

  // Used for the Auto-categorize review panel's title lookup — assignments come back as bare
  // ids scoped server-side, not tied to anything shown in this view directly.
  const bookmarkTitleById = useMemo(() => new Map(shortcuts.map((s) => [s.id, s.title])), [shortcuts]);

  const jobQuery = useDetectShortcutsJob(jobId);
  const isRunning = jobId !== null && jobQuery.data?.status !== "completed" && jobQuery.data?.status !== "failed";

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
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-3 flex-wrap">
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

          {subView === "category" && <CategorySuggestions type="shortcut" bookmarkTitleById={bookmarkTitleById} />}
        </div>

        <div className="flex items-center gap-2 shrink-0">
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
      </div>

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
          {shortcuts.map((s) => (
            <ShortcutTile key={s.id} bookmark={s} />
          ))}
        </div>
      ) : (
        <GroupedCardView
          bookmarks={shortcuts}
          // Shortcut tiles are compact and meant for scanning at a glance — unlike References'
          // (often long) lists, there's no real cost to always showing every group open.
          autoExpand
          categories={categories}
          categoryDescriptions={categoryDescriptions}
          renderItems={(items, moveToCategories) => (
            <div className="flex flex-wrap gap-3 pl-6 pt-2 pb-3">
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
