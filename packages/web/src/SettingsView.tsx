import { useMemo, useState } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { useCategoriesFull, useDeleteCategory, useRenameCategory, useSetCategoryDescription } from "./api";
import { NewCategoryForm } from "./NewCategoryForm";
import { CategoryPlanReview } from "./CategoryPlanReview";

interface SettingsViewProps {
  bookmarks: Bookmark[];
}

// One-stop category management: create/rename/remove/describe used to be scattered across the
// References and Shortcuts tabs (in each tab's group headers and toolbar). Consolidated here so
// there's a single place that defines what categories exist — the "Auto-categorize" button in
// each tab then just assigns bookmarks into whichever of these fits, it doesn't define them.
export function SettingsView({ bookmarks }: SettingsViewProps) {
  const { data: categories = [] } = useCategoriesFull();
  const renameMutation = useRenameCategory();
  const deleteMutation = useDeleteCategory();
  const descriptionMutation = useSetCategoryDescription();

  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [editingDescName, setEditingDescName] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState("");

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of bookmarks) {
      if (!b.category) continue;
      map.set(b.category, (map.get(b.category) ?? 0) + 1);
    }
    return map;
  }, [bookmarks]);

  const sorted = useMemo(() => [...categories].sort((a, b) => a.name.localeCompare(b.name)), [categories]);

  function startRename(name: string) {
    setRenamingName(name);
    setRenameDraft(name);
  }

  function commitRename(name: string) {
    const to = renameDraft.trim();
    setRenamingName(null);
    if (to && to !== name) {
      renameMutation.mutate({ from: name, to });
    }
  }

  function startEditDesc(name: string, current: string | null) {
    setEditingDescName(name);
    setDescDraft(current ?? "");
  }

  function commitDesc(name: string, current: string | null) {
    const value = descDraft.trim();
    setEditingDescName(null);
    if (value !== (current ?? "")) {
      descriptionMutation.mutate({ name, description: value });
    }
  }

  function handleDelete(name: string, count: number) {
    if (confirm(`Remove category "${name}"? Its ${count} bookmark${count === 1 ? "" : "s"} will become Uncategorized.`)) {
      deleteMutation.mutate(name);
    }
  }

  return (
    <div className="flex-1 min-w-0 p-4 overflow-y-auto">
      <div className="max-w-2xl">
        <h2 className="text-sm font-semibold mb-1">Categories</h2>
        <p className="text-xs text-neutral-400 mb-4">
          Define your categories here — name and description. Each tab's "Auto-categorize" button sorts
          bookmarks into whichever of these fits best, using the description as guidance; it never invents
          new categories, so keep this list current.
        </p>

        <div className="mb-4">
          <NewCategoryForm />
        </div>

        <CategoryPlanReview />

        {sorted.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-12">No categories yet — add one above.</p>
        ) : (
          <ul className="border border-neutral-200 dark:border-neutral-800 rounded-lg divide-y divide-neutral-200 dark:divide-neutral-800">
            {sorted.map((c) => {
              const isRenaming = renamingName === c.name;
              const isEditingDesc = editingDescName === c.name;
              const count = counts.get(c.name) ?? 0;

              return (
                <li key={c.name} className="p-3">
                  <div className="flex items-center gap-2">
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(c.name);
                          if (e.key === "Escape") setRenamingName(null);
                        }}
                        onBlur={() => commitRename(c.name)}
                        className="flex-1 font-semibold text-sm px-1.5 py-0.5 rounded border border-blue-400 outline-none bg-white dark:bg-neutral-950"
                      />
                    ) : (
                      <>
                        <span className="shrink-0 font-semibold text-sm">
                          {c.name} <span className="font-normal text-xs text-neutral-400">{count}</span>
                        </span>
                        {isEditingDesc ? (
                          <input
                            autoFocus
                            value={descDraft}
                            onChange={(e) => setDescDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitDesc(c.name, c.description);
                              if (e.key === "Escape") setEditingDescName(null);
                            }}
                            onBlur={() => commitDesc(c.name, c.description)}
                            placeholder="What's this category for?"
                            className="flex-1 min-w-0 text-xs px-2 py-1 rounded-md border border-blue-400 outline-none bg-white dark:bg-neutral-950 text-neutral-600 dark:text-neutral-400"
                          />
                        ) : (
                          <span className="flex-1 min-w-0 truncate text-xs text-neutral-400">
                            {c.description || <span className="text-neutral-300 dark:text-neutral-600 italic">No description</span>}
                          </span>
                        )}
                      </>
                    )}

                    {!isRenaming && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => startEditDesc(c.name, c.description)}
                          className="text-xs px-2 py-1 rounded-md text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >
                          Description
                        </button>
                        <button
                          onClick={() => startRename(c.name)}
                          className="text-xs px-2 py-1 rounded-md text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >
                          Rename
                        </button>
                        <button
                          onClick={() => handleDelete(c.name, count)}
                          className="text-xs px-2 py-1 rounded-md text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
