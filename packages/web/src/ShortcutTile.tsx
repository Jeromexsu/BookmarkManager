import { useState, type ChangeEvent } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { useDeleteBookmark, useUpdateBookmark } from "./api";
import { Favicon } from "./Favicon";

interface ShortcutTileProps {
  bookmark: Bookmark;
  // Same convention as BookmarkRow — every OTHER existing category, for the "Move to" dropdown.
  moveToCategories?: string[];
}

export function ShortcutTile({ bookmark, moveToCategories }: ShortcutTileProps) {
  const updateMutation = useUpdateBookmark();
  const deleteMutation = useDeleteBookmark();

  // A shortcut's whole point is a single click straight to the URL — expanding to edit can't
  // hijack that click, so it's a separate hover-revealed icon, not the tile itself.
  const [expanded, setExpanded] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState(bookmark.category ?? "");
  const [projectDraft, setProjectDraft] = useState(bookmark.project ?? "");

  function addTag() {
    const value = tagDraft.trim();
    if (value && !bookmark.tags.includes(value)) {
      updateMutation.mutate({ id: bookmark.id, patch: { tags: [...bookmark.tags, value] } });
    }
    setTagDraft("");
  }

  function removeTag(tag: string) {
    updateMutation.mutate({ id: bookmark.id, patch: { tags: bookmark.tags.filter((t) => t !== tag) } });
  }

  function commitCategory() {
    if (categoryDraft !== (bookmark.category ?? "")) {
      updateMutation.mutate({ id: bookmark.id, patch: { category: categoryDraft } });
    }
  }

  function commitProject() {
    if (projectDraft !== (bookmark.project ?? "")) {
      updateMutation.mutate({ id: bookmark.id, patch: { project: projectDraft } });
    }
  }

  function handleMoveTo(e: ChangeEvent<HTMLSelectElement>) {
    const target = e.target.value;
    e.target.value = "";
    if (target) {
      setCategoryDraft(target);
      updateMutation.mutate({ id: bookmark.id, patch: { category: target } });
    }
  }

  function handleRevert() {
    updateMutation.mutate({ id: bookmark.id, patch: { type: "reference" } });
  }

  function handleDelete() {
    if (confirm(`Delete "${bookmark.title}"?`)) {
      deleteMutation.mutate(bookmark.id);
    }
  }

  const hasMetadata = Boolean(bookmark.category) || Boolean(bookmark.project) || bookmark.tags.length > 0;

  return (
    <div className="w-24">
      <a
        href={bookmark.url}
        target="_blank"
        rel="noreferrer"
        className="group relative flex flex-col items-center gap-1.5 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
      >
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleDelete();
          }}
          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-600 text-xs"
          title="Delete"
        >
          ×
        </button>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-blue-600 text-xs"
          title="Category, project, tags"
        >
          ⋯
        </button>
        <Favicon favicon={bookmark.favicon} title={bookmark.title} size="md" />
        <span className="text-xs text-center truncate w-full">{bookmark.title}</span>
        {hasMetadata && (
          <div className="flex items-center gap-1" aria-hidden>
            {bookmark.category && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
            {bookmark.project && <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />}
            {bookmark.tags.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
          </div>
        )}
      </a>

      {expanded && (
        <div className="mt-1.5 p-2 w-56 rounded-lg border border-blue-200 dark:border-blue-900 bg-white dark:bg-neutral-950 shadow-lg relative z-10">
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            <input
              list="category-options"
              value={categoryDraft}
              onChange={(e) => setCategoryDraft(e.target.value)}
              onBlur={commitCategory}
              placeholder="Category"
              className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300 outline-none w-24 placeholder:text-amber-400"
            />
            {moveToCategories && moveToCategories.length > 0 && (
              <select
                onChange={handleMoveTo}
                defaultValue=""
                title="Move to a different category"
                className="text-xs px-1.5 py-0.5 rounded-full border border-neutral-200 dark:border-neutral-700 bg-transparent text-neutral-500 outline-none"
              >
                <option value="" disabled>
                  Move to…
                </option>
                {moveToCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            <input
              list="project-options"
              value={projectDraft}
              onChange={(e) => setProjectDraft(e.target.value)}
              onBlur={commitProject}
              placeholder="Project"
              className="text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-300 outline-none w-24 placeholder:text-violet-400"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            {bookmark.tags.map((tag) => (
              <span
                key={tag}
                className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-300 flex items-center gap-1"
              >
                {tag}
                <button onClick={() => removeTag(tag)} className="opacity-60 hover:opacity-100" aria-label={`Remove tag ${tag}`}>
                  ×
                </button>
              </span>
            ))}
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag();
                }
              }}
              onBlur={addTag}
              placeholder="+ tag"
              className="text-xs px-2 py-0.5 w-16 outline-none bg-transparent text-neutral-500"
            />
          </div>

          <div className="flex items-center justify-end pt-1.5 border-t border-neutral-100 dark:border-neutral-900">
            <button onClick={handleRevert} className="text-xs text-violet-600 dark:text-violet-400 hover:text-violet-700">
              Not a shortcut
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
