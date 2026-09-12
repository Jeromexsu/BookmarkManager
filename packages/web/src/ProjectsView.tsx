import { useState, type FormEvent } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { BookmarkRow } from "./BookmarkRow";
import { ShortcutTile } from "./ShortcutTile";
import { useCreateProject, useDeleteProject, useRenameProject, useUpdateBookmark } from "./api";

interface ProjectsViewProps {
  // Resolved bookmarks of either type — a project is a container that collects references
  // and shortcuts together, not a reference-only attribute.
  bookmarks: Bookmark[];
  // The full project name list, not just names derived from bookmarks — an empty (freshly
  // created) project has no bookmarks yet, so it wouldn't show up any other way.
  projects: string[];
}

function buildGroups(bookmarks: Bookmark[]): Map<string, Bookmark[]> {
  const groups = new Map<string, Bookmark[]>();
  for (const b of bookmarks) {
    if (!b.project) continue;
    const list = groups.get(b.project) ?? [];
    list.push(b);
    groups.set(b.project, list);
  }
  return groups;
}

export function ProjectsView({ bookmarks, projects }: ProjectsViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [addingToKey, setAddingToKey] = useState<string | null>(null);
  const [addQuery, setAddQuery] = useState("");

  const createMutation = useCreateProject();
  const renameMutation = useRenameProject();
  const deleteMutation = useDeleteProject();
  const updateMutation = useUpdateBookmark();

  const groups = buildGroups(bookmarks);
  const sortedKeys = [...projects].sort((a, b) => a.localeCompare(b));

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    await createMutation.mutateAsync(name);
    setExpanded((prev) => new Set(prev).add(name));
    setNewProjectName("");
    setIsCreating(false);
  }

  function startRename(key: string) {
    setRenamingKey(key);
    setRenameDraft(key);
  }

  function commitRename(key: string) {
    const to = renameDraft.trim();
    setRenamingKey(null);
    if (to && to !== key) {
      renameMutation.mutate({ from: key, to });
    }
  }

  function handleDeleteProject(key: string, count: number) {
    const impact = count === 0 ? "It has no bookmarks." : `Its ${count} bookmark${count === 1 ? "" : "s"} will stay — just no longer linked to it.`;
    if (confirm(`Remove project "${key}"? ${impact}`)) {
      deleteMutation.mutate(key);
    }
  }

  function toggleAdding(key: string) {
    setAddingToKey((prev) => (prev === key ? null : key));
    setAddQuery("");
  }

  return (
    <div className="flex-1 min-w-0 p-4 overflow-y-auto">
      <div className="flex items-center justify-end mb-3">
        {isCreating ? (
          <form onSubmit={handleCreate} className="flex items-center gap-2">
            <input
              autoFocus
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setIsCreating(false);
              }}
              placeholder="Project name"
              className="text-sm px-2 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="text-xs text-neutral-500 hover:text-neutral-700"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            onClick={() => setIsCreating(true)}
            className="px-3 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-900"
          >
            + New project
          </button>
        )}
      </div>

      {sortedKeys.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-12">No projects yet.</p>
      ) : (
        <div className="space-y-1">
          {sortedKeys.map((key) => {
            const items = groups.get(key) ?? [];
            const isOpen = expanded.has(key);
            const isRenaming = renamingKey === key;
            const isAdding = addingToKey === key;
            const references = items.filter((b) => b.type === "reference");
            const shortcuts = items.filter((b) => b.type === "shortcut");

            const addQ = addQuery.trim().toLowerCase();
            const addResults = isAdding && addQ
              ? bookmarks.filter((b) => b.project !== key && b.title.toLowerCase().includes(addQ)).slice(0, 20)
              : [];

            return (
              <div key={key}>
                <div className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-900">
                  <button onClick={() => toggle(key)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                    <span
                      className={`text-xs text-neutral-400 transition-transform inline-block ${isOpen ? "rotate-90" : ""}`}
                    >
                      ▸
                    </span>
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(key);
                          if (e.key === "Escape") setRenamingKey(null);
                        }}
                        onBlur={() => commitRename(key)}
                        className="font-semibold text-sm px-1.5 py-0.5 rounded border border-blue-400 outline-none bg-white dark:bg-neutral-950"
                      />
                    ) : (
                      <span className="font-semibold text-sm truncate">{key}</span>
                    )}
                    <span className="text-xs text-neutral-400">{items.length}</span>
                  </button>

                  {!isRenaming && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => toggleAdding(key)}
                        className="text-xs px-2 py-1 rounded-md text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        + Add
                      </button>
                      <button
                        onClick={() => startRename(key)}
                        className="text-xs px-2 py-1 rounded-md text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => handleDeleteProject(key, items.length)}
                        className="text-xs px-2 py-1 rounded-md text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>

                {isAdding && (
                  <div className="ml-6 mb-2 p-2 rounded-lg border border-blue-200 dark:border-blue-900">
                    <input
                      autoFocus
                      value={addQuery}
                      onChange={(e) => setAddQuery(e.target.value)}
                      placeholder="Search bookmarks to add…"
                      className="w-full text-sm px-2 py-1 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 outline-none focus:border-blue-500"
                    />
                    {addResults.length > 0 && (
                      <ul className="mt-2 space-y-1 max-h-60 overflow-y-auto">
                        {addResults.map((b) => (
                          <li key={b.id} className="flex items-center justify-between gap-2 text-sm py-0.5">
                            <span className="truncate">{b.title}</span>
                            <button
                              onClick={() => updateMutation.mutate({ id: b.id, patch: { project: key } })}
                              className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-blue-600 text-white hover:bg-blue-700"
                            >
                              Add
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {addQ !== "" && addResults.length === 0 && <p className="text-xs text-neutral-400 mt-2">No matches.</p>}
                  </div>
                )}

                {isOpen && (
                  <div className="pl-6 pb-4 space-y-4">
                    {items.length === 0 && (
                      <p className="text-xs text-neutral-400">Nothing here yet — use "+ Add" to add bookmarks.</p>
                    )}
                    {references.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">
                          References
                        </p>
                        <ul className="space-y-2">
                          {references.map((b) => (
                            <BookmarkRow
                              key={b.id}
                              bookmark={b}
                              onRemoveFromProject={() => updateMutation.mutate({ id: b.id, patch: { project: "" } })}
                            />
                          ))}
                        </ul>
                      </div>
                    )}
                    {shortcuts.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">
                          Shortcuts
                        </p>
                        <div className="flex flex-wrap gap-3">
                          {shortcuts.map((s) => (
                            <ShortcutTile
                              key={s.id}
                              bookmark={s}
                              onRemoveFromProject={() => updateMutation.mutate({ id: s.id, patch: { project: "" } })}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
