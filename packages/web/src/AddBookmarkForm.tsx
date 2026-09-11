import { useState, type FormEvent } from "react";
import { useCreateBookmark } from "./api";

export function AddBookmarkForm() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const createMutation = useCreateBookmark();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url || !title) return;
    await createMutation.mutateAsync({ url, title, content: content || undefined });
    setUrl("");
    setTitle("");
    setContent("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
      >
        + Add bookmark manually
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-2 mb-4 p-3 border border-neutral-200 dark:border-neutral-800 rounded-lg">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="URL"
        required
        className="px-2 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-sm outline-none focus:border-blue-500"
      />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        required
        className="px-2 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-sm outline-none focus:border-blue-500"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Page content (optional — enables AI tagging)"
        rows={3}
        className="px-2 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-sm outline-none focus:border-blue-500"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-3 py-1.5 rounded-md text-sm text-neutral-500 hover:text-neutral-700"
        >
          Cancel
        </button>
      </div>
      {createMutation.isError && <p className="text-xs text-red-600">Failed to save bookmark.</p>}
    </form>
  );
}
