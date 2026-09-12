import { useState, type FormEvent } from "react";
import { useCreateCategory } from "./api";

export function NewCategoryForm() {
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const createMutation = useCreateCategory();

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await createMutation.mutateAsync({ name: trimmed, description: description.trim() || undefined });
    setName("");
    setDescription("");
    setIsCreating(false);
  }

  if (!isCreating) {
    return (
      <button
        onClick={() => setIsCreating(true)}
        className="px-3 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 text-xs font-medium hover:bg-neutral-50 dark:hover:bg-neutral-900"
      >
        + New category
      </button>
    );
  }

  return (
    <form onSubmit={handleCreate} className="flex items-center gap-2 flex-wrap">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setIsCreating(false);
        }}
        placeholder="Category name"
        className="text-xs px-2 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 outline-none focus:border-blue-500"
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setIsCreating(false);
        }}
        placeholder="Description (optional)"
        className="text-xs px-2 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 outline-none focus:border-blue-500 w-48"
      />
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
    </form>
  );
}
