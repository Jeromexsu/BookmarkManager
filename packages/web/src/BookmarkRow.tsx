import { useState, type ChangeEvent } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { useDeleteBookmark, useSuggestTitle, useUpdateBookmark } from "./api";
import { Favicon } from "./Favicon";

interface BookmarkRowProps {
  bookmark: Bookmark;
  // Shown only in the Pending view — an unresolved item might just be a shortcut import
  // couldn't scrape, not something that needs tags at all.
  showResolveActions?: boolean;
  // Shown only in the Category view — every OTHER existing category, for a one-click move
  // (distinct from the free-text category field, which is for typing/creating one).
  moveToCategories?: string[];
}

export function BookmarkRow({ bookmark, showResolveActions = false, moveToCategories }: BookmarkRowProps) {
  const updateMutation = useUpdateBookmark();
  const deleteMutation = useDeleteBookmark();
  const suggestTitleMutation = useSuggestTitle();
  const [tagDraft, setTagDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState(bookmark.category ?? "");
  const [projectDraft, setProjectDraft] = useState(bookmark.project ?? "");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(bookmark.title);

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

  function handleDelete() {
    if (confirm(`Delete "${bookmark.title}"?`)) {
      deleteMutation.mutate(bookmark.id);
    }
  }

  function handleMarkAsShortcut() {
    updateMutation.mutate({ id: bookmark.id, patch: { type: "shortcut" } });
  }

  function handleMoveTo(e: ChangeEvent<HTMLSelectElement>) {
    const target = e.target.value;
    e.target.value = ""; // reset to the placeholder — this is a one-shot action, not a field
    if (target) {
      setCategoryDraft(target);
      updateMutation.mutate({ id: bookmark.id, patch: { category: target } });
    }
  }

  // Explicit resolve for the "this is fine as-is, no tags needed" case — adding tags/a summary
  // resolves it too, as a side effect, but that's a convenience, not the only path.
  function handleMarkResolved() {
    updateMutation.mutate({ id: bookmark.id, patch: { resolved: true } });
  }

  function startEditTitle() {
    setTitleDraft(bookmark.title);
    setIsEditingTitle(true);
  }

  function commitTitle() {
    setIsEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== bookmark.title) {
      updateMutation.mutate({ id: bookmark.id, patch: { title: trimmed } });
    }
  }

  async function handleSuggestTitle() {
    if (!bookmark.content) return;
    const suggested = await suggestTitleMutation.mutateAsync({ title: bookmark.title, content: bookmark.content });
    setTitleDraft(suggested);
  }

  return (
    <li className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 flex gap-3">
      <div className="mt-1">
        <Favicon favicon={bookmark.favicon} title={bookmark.title} size="sm" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          {isEditingTitle ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTitle();
                  if (e.key === "Escape") setIsEditingTitle(false);
                }}
                onBlur={commitTitle}
                className="flex-1 min-w-0 font-semibold text-sm px-1.5 py-0.5 rounded border border-blue-400 outline-none bg-white dark:bg-neutral-950"
              />
              {bookmark.content && (
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleSuggestTitle}
                  disabled={suggestTitleMutation.isPending}
                  title="Suggest a title from the page content"
                  className="shrink-0 text-xs px-2 py-1 rounded-md border border-neutral-200 dark:border-neutral-800 text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50 whitespace-nowrap"
                >
                  {suggestTitleMutation.isPending ? "Suggesting…" : "Suggest"}
                </button>
              )}
            </div>
          ) : (
            <a
              href={bookmark.url}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-sm hover:underline truncate"
            >
              {bookmark.title}
            </a>
          )}
          <div className="flex items-center gap-2 shrink-0">
            {!isEditingTitle && (
              <button
                onClick={startEditTitle}
                className="text-xs px-2 py-1 rounded-md text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                Rename
              </button>
            )}
            {showResolveActions && (
              <>
                <button
                  onClick={handleMarkResolved}
                  className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 text-xs font-medium whitespace-nowrap"
                >
                  ✓ Mark resolved
                </button>
                <button
                  onClick={handleMarkAsShortcut}
                  className="text-violet-600 dark:text-violet-400 hover:text-violet-700 text-xs font-medium whitespace-nowrap"
                >
                  📦 It's a shortcut
                </button>
              </>
            )}
            <button onClick={handleDelete} className="text-neutral-400 hover:text-red-600 text-xs">
              Delete
            </button>
          </div>
        </div>
        <div className="text-xs text-neutral-500 truncate">{bookmark.url}</div>

        {/* Only the failure reason is worth a badge here — "pending" is already the whole point
            of the view this card lives in, so repeating it on every card is just noise. */}
        {bookmark.status === "failed" && bookmark.tags.length === 0 && !bookmark.summary && (
          <div className="text-xs text-red-600 mt-1">Tagging failed</div>
        )}
        {bookmark.summary && <p className="text-sm mt-1.5 text-neutral-700 dark:text-neutral-300">{bookmark.summary}</p>}

        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <input
            list="category-options"
            value={categoryDraft}
            onChange={(e) => setCategoryDraft(e.target.value)}
            onBlur={commitCategory}
            placeholder="Category"
            className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300 outline-none w-36 placeholder:text-amber-400"
          />
        </div>

        {moveToCategories && moveToCategories.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
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
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <input
            list="project-options"
            value={projectDraft}
            onChange={(e) => setProjectDraft(e.target.value)}
            onBlur={commitProject}
            placeholder="Project"
            className="text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-300 outline-none w-24 placeholder:text-violet-400"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
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
      </div>
    </li>
  );
}
