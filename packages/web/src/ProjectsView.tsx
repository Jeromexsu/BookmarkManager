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

interface ProjectCardProps {
  name: string;
  count: number;
  isRenaming: boolean;
  renameDraft: string;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onStartRename: () => void;
  onDelete: () => void;
  onOpen: () => void;
}

function ProjectCard({
  name,
  count,
  isRenaming,
  renameDraft,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onStartRename,
  onDelete,
  onOpen,
}: ProjectCardProps) {
  return (
    <div
      onClick={!isRenaming ? onOpen : undefined}
      className={`group relative border border-neutral-200 dark:border-neutral-800 rounded-xl bg-neutral-50 dark:bg-neutral-900 shadow-sm hover:shadow-md transition-shadow p-4 ${
        isRenaming ? "" : "cursor-pointer"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl leading-none" aria-hidden>
          📦
        </span>
        {!isRenaming && (
          <div
            className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={onStartRename}
              className="text-xs px-1.5 py-0.5 rounded text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800"
            >
              Rename
            </button>
            <button
              onClick={onDelete}
              className="text-xs px-1.5 py-0.5 rounded text-neutral-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950"
            >
              Remove
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 min-w-0">
        {isRenaming ? (
          <input
            autoFocus
            value={renameDraft}
            onChange={(e) => onRenameDraftChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitRename();
              if (e.key === "Escape") onCancelRename();
            }}
            onBlur={onCommitRename}
            className="w-full font-semibold text-sm px-1.5 py-0.5 rounded border border-blue-400 outline-none bg-white dark:bg-neutral-950"
          />
        ) : (
          <p className="font-semibold text-sm truncate">{name}</p>
        )}
        <p className="text-xs text-neutral-400 mt-1">
          {count} bookmark{count === 1 ? "" : "s"}
        </p>
      </div>
    </div>
  );
}

export function ProjectsView({ bookmarks, projects }: ProjectsViewProps) {
  const [openProjectKey, setOpenProjectKey] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [addQuery, setAddQuery] = useState("");

  const createMutation = useCreateProject();
  const renameMutation = useRenameProject();
  const deleteMutation = useDeleteProject();
  const updateMutation = useUpdateBookmark();

  const groups = buildGroups(bookmarks);
  const sortedKeys = [...projects].sort((a, b) => a.localeCompare(b));

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    await createMutation.mutateAsync(name);
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
      // Follow the rename so the detail view doesn't just fall back to the grid because its
      // key no longer matches anything.
      if (openProjectKey === key) setOpenProjectKey(to);
    }
  }

  function handleDeleteProject(key: string, count: number) {
    const impact =
      count === 0 ? "It has no bookmarks." : `Its ${count} bookmark${count === 1 ? "" : "s"} will stay — just no longer linked to it.`;
    if (confirm(`Remove project "${key}"? ${impact}`)) {
      deleteMutation.mutate(key);
    }
  }

  // Falls back to the grid on its own if the open project no longer exists (deleted, or a
  // rename that hasn't round-tripped through the server yet).
  const openProject = openProjectKey && sortedKeys.includes(openProjectKey) ? openProjectKey : null;

  if (openProject) {
    const items = groups.get(openProject) ?? [];
    const references = items.filter((b) => b.type === "reference");
    const shortcuts = items.filter((b) => b.type === "shortcut");
    const isRenaming = renamingKey === openProject;

    const addQ = addQuery.trim().toLowerCase();
    const addResults = isAdding && addQ ? bookmarks.filter((b) => b.project !== openProject && b.title.toLowerCase().includes(addQ)).slice(0, 20) : [];

    return (
      <div className="flex-1 min-w-0 p-4 overflow-y-auto">
        <button
          onClick={() => setOpenProjectKey(null)}
          className="text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 mb-3"
        >
          ← Projects
        </button>

        <div className="flex items-center justify-between gap-2 mb-4">
          {isRenaming ? (
            <input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename(openProject);
                if (e.key === "Escape") setRenamingKey(null);
              }}
              onBlur={() => commitRename(openProject)}
              className="text-lg font-bold px-1.5 py-0.5 rounded border border-blue-400 outline-none bg-white dark:bg-neutral-950"
            />
          ) : (
            <h2 className="text-lg font-bold truncate">
              📦 {openProject} <span className="text-sm font-normal text-neutral-400">{items.length}</span>
            </h2>
          )}

          {!isRenaming && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => {
                  setIsAdding((v) => !v);
                  setAddQuery("");
                }}
                className="text-xs px-2 py-1 rounded-md text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                + Add
              </button>
              <button
                onClick={() => startRename(openProject)}
                className="text-xs px-2 py-1 rounded-md text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                Rename
              </button>
              <button
                onClick={() => handleDeleteProject(openProject, items.length)}
                className="text-xs px-2 py-1 rounded-md text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
              >
                Remove
              </button>
            </div>
          )}
        </div>

        {isAdding && (
          <div className="mb-4 p-3 rounded-lg border border-blue-200 dark:border-blue-900">
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
                      onClick={() => updateMutation.mutate({ id: b.id, patch: { project: openProject } })}
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

        {items.length === 0 && <p className="text-sm text-neutral-400 text-center py-12">Nothing here yet — use "+ Add" to add bookmarks.</p>}

        <div className="space-y-4">
          {references.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">References</p>
              <ul className="space-y-3">
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
              <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1.5">Shortcuts</p>
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
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 p-4 overflow-y-auto">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {isCreating ? (
          <form
            onSubmit={handleCreate}
            className="border border-blue-300 dark:border-blue-800 rounded-xl bg-neutral-50 dark:bg-neutral-900 shadow-sm p-4 flex flex-col gap-2"
          >
            <input
              autoFocus
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setIsCreating(false);
              }}
              placeholder="Project name"
              className="text-sm px-2 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 outline-none focus:border-blue-500"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                Create
              </button>
              <button type="button" onClick={() => setIsCreating(false)} className="text-xs text-neutral-500 hover:text-neutral-700">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setIsCreating(true)}
            className="border border-dashed border-neutral-300 dark:border-neutral-700 rounded-xl p-4 flex flex-col items-center justify-center gap-1.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:border-neutral-400 dark:hover:border-neutral-600 transition-colors min-h-[104px]"
          >
            <span className="text-2xl leading-none" aria-hidden>
              +
            </span>
            <span className="text-sm font-medium">New project</span>
          </button>
        )}

        {sortedKeys.map((key) => (
          <ProjectCard
            key={key}
            name={key}
            count={groups.get(key)?.length ?? 0}
            isRenaming={renamingKey === key}
            renameDraft={renameDraft}
            onRenameDraftChange={setRenameDraft}
            onCommitRename={() => commitRename(key)}
            onCancelRename={() => setRenamingKey(null)}
            onStartRename={() => startRename(key)}
            onDelete={() => handleDeleteProject(key, groups.get(key)?.length ?? 0)}
            onOpen={() => setOpenProjectKey(key)}
          />
        ))}
      </div>

      {sortedKeys.length === 0 && !isCreating && (
        <p className="text-sm text-neutral-400 text-center py-12">No projects yet — click "New project" to make one.</p>
      )}
    </div>
  );
}
