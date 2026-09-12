import { useEffect, useState } from "react";
import type { BookmarkType, SuggestCategoriesScope } from "@bookmark-manager/shared";
import { useApplyCategories, useCategorySuggestionJob, useStartSuggestCategories } from "./api";

// Persisted (not component state) so the job survives a tab switch, a reload, or closing and
// reopening the page entirely — the actual work lives server-side as a job row; this is just
// "which job am I watching," which needs to outlive the component too. Keyed by type since
// References and Shortcuts each render their own instance of this component and must not read
// or resume each other's job.
function storageKey(type: BookmarkType): string {
  return `categorySuggestionJobId:${type}`;
}

function readStoredJobId(type: BookmarkType): number | null {
  const raw = localStorage.getItem(storageKey(type));
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

interface CategorySuggestionsProps {
  type: BookmarkType;
  // Keyed by id so the review panel can show titles without a second fetch — suggestions come
  // back as bare ids, scoped server-side (uncategorized-only, or every resolved bookmark of this
  // view's type), not just the current search results, so the lookup needs to cover the full
  // unfiltered set.
  bookmarkTitleById: Map<number, string>;
}

export function CategorySuggestions({ type, bookmarkTitleById }: CategorySuggestionsProps) {
  const startMutation = useStartSuggestCategories();
  const applyMutation = useApplyCategories();
  const [scope, setScope] = useState<SuggestCategoriesScope>("uncategorized");
  const [jobId, setJobId] = useState<number | null>(() => readStoredJobId(type));
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const jobQuery = useCategorySuggestionJob(jobId);
  const isRunning = jobId !== null && jobQuery.data?.status !== "completed" && jobQuery.data?.status !== "failed";

  // Large batches can legitimately take 30-90s against the model with no intermediate
  // progress — a ticking counter is the difference between "still working" and "looks hung".
  // Anchored to the job's actual createdAt (not this component's mount time) so reopening the
  // page after a while shows real elapsed time, not a counter that restarted from zero.
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

  async function handleSuggest() {
    const newJobId = await startMutation.mutateAsync({ scope, type });
    localStorage.setItem(storageKey(type), String(newJobId));
    setExcluded(new Set());
    setExpanded(new Set());
    setJobId(newJobId);
  }

  function dismiss() {
    localStorage.removeItem(storageKey(type));
    setJobId(null);
  }

  function toggleSet(set: Set<string>, setSet: (s: Set<string>) => void, key: string) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSet(next);
  }

  async function handleApply() {
    const suggestions = jobQuery.data?.suggestions;
    if (!suggestions) return;
    const assignments = suggestions
      .filter((s) => !excluded.has(s.category))
      .flatMap((s) => s.bookmarkIds.map((id) => ({ id, category: s.category })));

    if (assignments.length > 0) {
      await applyMutation.mutateAsync(assignments);
    }
    dismiss();
  }

  if (jobId === null) {
    return (
      <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 flex items-center gap-3 flex-wrap">
        <div className="flex bg-neutral-100 dark:bg-neutral-800 rounded-md p-0.5">
          {(["uncategorized", "all"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`text-xs font-semibold px-2.5 py-1 rounded transition ${
                scope === s
                  ? "bg-white dark:bg-neutral-950 shadow-sm"
                  : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
              }`}
            >
              {s === "uncategorized" ? "Uncategorized only" : type === "reference" ? "All references" : "All shortcuts"}
            </button>
          ))}
        </div>

        <button
          onClick={handleSuggest}
          disabled={startMutation.isPending}
          className="px-3 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50"
        >
          Auto-categorize
        </button>

        {startMutation.isError && <p className="text-xs text-red-600">Couldn't start auto-categorization.</p>}
      </div>
    );
  }

  if (isRunning) {
    return (
      <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 flex items-center gap-3 flex-wrap">
        <p className="text-sm font-medium">Auto-categorizing… {elapsedSeconds}s</p>
        <p className="text-xs text-neutral-400">
          Large batches can take up to a minute or two — it's working, not stuck. Feel free to switch tabs or come
          back later; the result will be waiting here.
        </p>
        <button
          onClick={dismiss}
          className="ml-auto px-3 py-1 rounded-md text-xs font-medium text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          Hide
        </button>
      </div>
    );
  }

  if (jobQuery.data?.status === "failed") {
    return (
      <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
        <p className="text-sm text-red-600">Couldn't auto-categorize: {jobQuery.data.error ?? "unknown error"}</p>
        <button
          onClick={dismiss}
          className="shrink-0 px-3 py-1 rounded-md text-xs font-medium text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          Dismiss
        </button>
      </div>
    );
  }

  const suggestions = jobQuery.data?.suggestions ?? [];

  if (suggestions.length === 0) {
    return (
      <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
        <p className="text-sm text-neutral-400">Nothing to categorize.</p>
        <button
          onClick={dismiss}
          className="px-3 py-1 rounded-md text-xs font-medium text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium">Auto-categorize results</p>
        <div className="flex gap-2">
          <button
            onClick={handleApply}
            disabled={applyMutation.isPending}
            className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            Apply
          </button>
          <button
            onClick={dismiss}
            className="px-3 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 text-xs font-medium hover:bg-neutral-50 dark:hover:bg-neutral-900"
          >
            Dismiss
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => {
          const isExcluded = excluded.has(s.category);
          const isExpanded = expanded.has(s.category);
          return (
            <div
              key={s.category}
              className={`rounded-lg border overflow-hidden transition ${
                isExcluded
                  ? "border-neutral-200 dark:border-neutral-800 opacity-50"
                  : "border-blue-200 dark:border-blue-900"
              }`}
            >
              <div className="flex items-center">
                <button
                  onClick={() => toggleSet(excluded, setExcluded, s.category)}
                  title={isExcluded ? "Excluded — click to include" : "Included — click to exclude"}
                  className={`px-2.5 py-1.5 text-sm font-semibold flex items-center gap-1.5 ${
                    isExcluded
                      ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-500"
                      : "bg-blue-50 dark:bg-blue-950 text-blue-800 dark:text-blue-300"
                  }`}
                >
                  <span aria-hidden>{isExcluded ? "○" : "●"}</span>
                  {s.category}
                  <span className="text-xs font-normal opacity-70">{s.bookmarkIds.length}</span>
                </button>
                <button
                  onClick={() => toggleSet(expanded, setExpanded, s.category)}
                  title="Preview bookmarks in this category"
                  className={`px-2 py-1.5 text-xs border-l ${
                    isExcluded
                      ? "border-neutral-200 dark:border-neutral-800 text-neutral-400"
                      : "border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-400"
                  } hover:bg-neutral-50 dark:hover:bg-neutral-900`}
                >
                  {isExpanded ? "▴" : "▾"}
                </button>
              </div>
              {isExpanded && (
                <ul className="px-2.5 py-2 text-xs text-neutral-500 dark:text-neutral-400 space-y-0.5 bg-neutral-50 dark:bg-neutral-900 max-w-xs">
                  {s.bookmarkIds.map((id) => (
                    <li key={id} className="truncate">
                      {bookmarkTitleById.get(id) ?? `#${id}`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
