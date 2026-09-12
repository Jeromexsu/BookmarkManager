import { useEffect, useState } from "react";
import {
  useCategoryPlanJob,
  useCreateCategory,
  useDeleteCategory,
  useRenameCategory,
  useSetCategoryDescription,
  useStartCategoryPlan,
} from "./api";

// Persisted so the job survives a tab switch, a reload, or closing and reopening the page —
// same reasoning as CategorySuggestions' STORAGE_KEY.
const STORAGE_KEY = "categoryPlanJobId";

function readStoredJobId(): number | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

// Recommends changes to the taxonomy itself (add/rename/remove/describe) — distinct from each
// tab's "Auto-categorize", which only assigns bookmarks into whatever categories already exist.
// Applying an accepted plan is just replaying it through the same create/rename/delete/describe
// mutations Settings already uses for manual edits, one call per accepted item.
export function CategoryPlanReview() {
  const startMutation = useStartCategoryPlan();
  const createMutation = useCreateCategory();
  const renameMutation = useRenameCategory();
  const deleteMutation = useDeleteCategory();
  const descriptionMutation = useSetCategoryDescription();

  const [jobId, setJobId] = useState<number | null>(readStoredJobId);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [applying, setApplying] = useState(false);

  const jobQuery = useCategoryPlanJob(jobId);
  const isRunning = jobId !== null && jobQuery.data?.status !== "completed" && jobQuery.data?.status !== "failed";

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

  async function handleStart() {
    const newJobId = await startMutation.mutateAsync();
    localStorage.setItem(STORAGE_KEY, String(newJobId));
    setExcluded(new Set());
    setJobId(newJobId);
  }

  function dismiss() {
    localStorage.removeItem(STORAGE_KEY);
    setJobId(null);
  }

  function toggle(key: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleApply() {
    const plan = jobQuery.data?.plan;
    if (!plan) return;

    setApplying(true);
    try {
      // Renames first (so a merge target exists), then removes, then adds, then descriptions —
      // a describe can target a rename's "to" side, so it must run last.
      for (const r of plan.rename) {
        if (!excluded.has(`rename:${r.from}`)) await renameMutation.mutateAsync({ from: r.from, to: r.to });
      }
      for (const r of plan.remove) {
        if (!excluded.has(`remove:${r.name}`)) await deleteMutation.mutateAsync(r.name);
      }
      for (const a of plan.add) {
        if (!excluded.has(`add:${a.name}`)) await createMutation.mutateAsync({ name: a.name, description: a.description });
      }
      for (const d of plan.describe) {
        if (!excluded.has(`describe:${d.name}`)) {
          await descriptionMutation.mutateAsync({ name: d.name, description: d.description });
        }
      }
      dismiss();
    } finally {
      setApplying(false);
    }
  }

  if (jobId === null) {
    return (
      <div className="mb-4 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 flex items-center gap-3 flex-wrap">
        <button
          onClick={handleStart}
          disabled={startMutation.isPending}
          className="px-3 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50"
        >
          Recommend changes
        </button>
        <p className="text-xs text-neutral-400">
          Looks at your current categories and bookmarks to suggest what to add, rename, remove, or describe.
        </p>
        {startMutation.isError && <p className="text-xs text-red-600">Couldn't start the recommendation job.</p>}
      </div>
    );
  }

  if (isRunning) {
    return (
      <div className="mb-4 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 flex items-center gap-3 flex-wrap">
        <p className="text-sm font-medium">Analyzing your categories… {elapsedSeconds}s</p>
        <p className="text-xs text-neutral-400">
          Can take up to a minute or two — it's working, not stuck. Feel free to switch tabs or come back later.
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
      <div className="mb-4 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
        <p className="text-sm text-red-600">Couldn't recommend changes: {jobQuery.data.error ?? "unknown error"}</p>
        <button
          onClick={dismiss}
          className="shrink-0 px-3 py-1 rounded-md text-xs font-medium text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          Dismiss
        </button>
      </div>
    );
  }

  const plan = jobQuery.data?.plan;
  const totalItems = plan ? plan.add.length + plan.rename.length + plan.remove.length + plan.describe.length : 0;

  if (!plan || totalItems === 0) {
    return (
      <div className="mb-4 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
        <p className="text-sm text-neutral-400">Your category list already looks in good shape — no changes suggested.</p>
        <button
          onClick={dismiss}
          className="px-3 py-1 rounded-md text-xs font-medium text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          Dismiss
        </button>
      </div>
    );
  }

  const includedCount = totalItems - excluded.size;

  return (
    <div className="mb-4 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium">Recommended changes</p>
        <div className="flex gap-2">
          <button
            onClick={handleApply}
            disabled={applying || includedCount === 0}
            className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {applying ? "Applying…" : `Apply ${includedCount}`}
          </button>
          <button
            onClick={dismiss}
            disabled={applying}
            className="px-3 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 text-xs font-medium hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {plan.add.length > 0 && (
          <PlanSection title="Add">
            {plan.add.map((a) => (
              <PlanRow
                key={`add:${a.name}`}
                checked={!excluded.has(`add:${a.name}`)}
                onToggle={() => toggle(`add:${a.name}`)}
                headline={a.name}
                detail={a.description}
                reason={a.reason}
              />
            ))}
          </PlanSection>
        )}

        {plan.rename.length > 0 && (
          <PlanSection title="Rename">
            {plan.rename.map((r) => (
              <PlanRow
                key={`rename:${r.from}`}
                checked={!excluded.has(`rename:${r.from}`)}
                onToggle={() => toggle(`rename:${r.from}`)}
                headline={`${r.from} → ${r.to}`}
                reason={r.reason}
              />
            ))}
          </PlanSection>
        )}

        {plan.remove.length > 0 && (
          <PlanSection title="Remove">
            {plan.remove.map((r) => (
              <PlanRow
                key={`remove:${r.name}`}
                checked={!excluded.has(`remove:${r.name}`)}
                onToggle={() => toggle(`remove:${r.name}`)}
                headline={r.name}
                reason={r.reason}
              />
            ))}
          </PlanSection>
        )}

        {plan.describe.length > 0 && (
          <PlanSection title="Describe">
            {plan.describe.map((d) => (
              <PlanRow
                key={`describe:${d.name}`}
                checked={!excluded.has(`describe:${d.name}`)}
                onToggle={() => toggle(`describe:${d.name}`)}
                headline={d.name}
                detail={d.description}
                reason={d.reason}
              />
            ))}
          </PlanSection>
        )}
      </div>
    </div>
  );
}

function PlanSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">{title}</p>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  );
}

interface PlanRowProps {
  checked: boolean;
  onToggle: () => void;
  headline: string;
  detail?: string;
  reason: string;
}

function PlanRow({ checked, onToggle, headline, detail, reason }: PlanRowProps) {
  return (
    <li className="flex items-start gap-2">
      <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1 shrink-0" />
      <div className={`min-w-0 ${checked ? "" : "opacity-50"}`}>
        <p className="text-sm font-medium">{headline}</p>
        {detail && <p className="text-xs text-neutral-500 dark:text-neutral-400">{detail}</p>}
        <p className="text-xs text-neutral-400 italic">{reason}</p>
      </div>
    </li>
  );
}
