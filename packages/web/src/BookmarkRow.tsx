import { useState } from "react";
import type { Bookmark } from "@bookmark-manager/shared";
import { useDeleteBookmark, useUpdateBookmark } from "./api";
import { Favicon } from "./Favicon";

interface BookmarkRowProps {
  bookmark: Bookmark;
}

export function BookmarkRow({ bookmark }: BookmarkRowProps) {
  const updateMutation = useUpdateBookmark();
  const deleteMutation = useDeleteBookmark();
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

  function handleDelete() {
    if (confirm(`Delete "${bookmark.title}"?`)) {
      deleteMutation.mutate(bookmark.id);
    }
  }

  return (
    <li className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-3 flex gap-3">
      <div className="mt-1">
        <Favicon favicon={bookmark.favicon} title={bookmark.title} size="sm" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <a
            href={bookmark.url}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-sm hover:underline truncate"
          >
            {bookmark.title}
          </a>
          <button
            onClick={handleDelete}
            className="text-neutral-400 hover:text-red-600 text-xs shrink-0"
          >
            Delete
          </button>
        </div>
        <div className="text-xs text-neutral-500 truncate">{bookmark.url}</div>

        {/* status is only meaningful until the user has actually added tags/a summary by hand —
            trusting it blindly would keep showing a stale badge over data they've since filled in. */}
        {bookmark.status === "pending" && bookmark.tags.length === 0 && !bookmark.summary && (
          <div className="text-xs text-amber-600 mt-1">Untagged</div>
        )}
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
            className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300 outline-none w-24 placeholder:text-amber-400"
          />
          <input
            list="project-options"
            value={projectDraft}
            onChange={(e) => setProjectDraft(e.target.value)}
            onBlur={commitProject}
            placeholder="Project"
            className="text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-300 outline-none w-24 placeholder:text-violet-400"
          />
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
