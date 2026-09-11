import {
  type Bookmark,
  type CreateBookmarkRequest,
  type UpdateBookmarkRequest,
  type ShortcutCandidate,
  listBookmarksResponseSchema,
  bookmarkSchema,
  nameListResponseSchema,
  detectShortcutsResponseSchema,
} from "@bookmark-manager/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

async function listBookmarks(): Promise<Bookmark[]> {
  const res = await fetch("/api/bookmarks");
  if (!res.ok) throw new Error(`Failed to load bookmarks: ${res.status}`);
  const data = listBookmarksResponseSchema.parse(await res.json());
  return data.bookmarks;
}

async function createBookmark(input: CreateBookmarkRequest): Promise<Bookmark> {
  const res = await fetch("/api/bookmarks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to create bookmark: ${res.status}`);
  return bookmarkSchema.parse(await res.json());
}

async function updateBookmark(id: number, patch: UpdateBookmarkRequest): Promise<Bookmark> {
  const res = await fetch(`/api/bookmarks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Failed to update bookmark: ${res.status}`);
  return bookmarkSchema.parse(await res.json());
}

async function deleteBookmark(id: number): Promise<void> {
  const res = await fetch(`/api/bookmarks/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete bookmark: ${res.status}`);
}

async function listNames(path: "categories" | "projects"): Promise<string[]> {
  const res = await fetch(`/api/${path}`);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return nameListResponseSchema.parse(await res.json()).names;
}

async function detectShortcuts(): Promise<ShortcutCandidate[]> {
  const res = await fetch("/api/bookmarks/detect-shortcuts", { method: "POST" });
  if (!res.ok) throw new Error(`Failed to detect shortcuts: ${res.status}`);
  return detectShortcutsResponseSchema.parse(await res.json()).candidates;
}

async function confirmShortcuts(ids: number[]): Promise<void> {
  const res = await fetch("/api/bookmarks/confirm-shortcuts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Failed to confirm shortcuts: ${res.status}`);
}

const bookmarksKey = ["bookmarks"] as const;

export function useBookmarks() {
  return useQuery({
    queryKey: bookmarksKey,
    queryFn: listBookmarks,
    // Picks up async tagging (status: "pending" -> "resolved") without a manual refresh.
    refetchInterval: 5000,
  });
}

export function useCategories() {
  return useQuery({ queryKey: ["categories"], queryFn: () => listNames("categories") });
}

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: () => listNames("projects") });
}

export function useCreateBookmark() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBookmark,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bookmarksKey }),
  });
}

export function useUpdateBookmark() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: UpdateBookmarkRequest }) => updateBookmark(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bookmarksKey });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDeleteBookmark() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteBookmark,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bookmarksKey }),
  });
}

export function useDetectShortcuts() {
  return useMutation({ mutationFn: detectShortcuts });
}

export function useConfirmShortcuts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: confirmShortcuts,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bookmarksKey }),
  });
}
