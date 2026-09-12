import {
  type Bookmark,
  type UpdateBookmarkRequest,
  type SuggestCategoriesScope,
  type RenameCategoryResponse,
  type RenameProjectResponse,
  type CategorySuggestionJob,
  type DetectShortcutsJob,
  listBookmarksResponseSchema,
  bookmarkSchema,
  nameListResponseSchema,
  startSuggestCategoriesResponseSchema,
  categorySuggestionJobSchema,
  renameCategoryResponseSchema,
  suggestTitleResponseSchema,
  startDetectShortcutsResponseSchema,
  detectShortcutsJobSchema,
  clearShortcutCacheResponseSchema,
  renameProjectResponseSchema,
} from "@bookmark-manager/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

async function listBookmarks(): Promise<Bookmark[]> {
  const res = await fetch("/api/bookmarks");
  if (!res.ok) throw new Error(`Failed to load bookmarks: ${res.status}`);
  const data = listBookmarksResponseSchema.parse(await res.json());
  return data.bookmarks;
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

async function startDetectShortcuts(): Promise<number> {
  const res = await fetch("/api/bookmarks/detect-shortcuts", { method: "POST" });
  if (!res.ok) throw new Error(`Failed to start shortcut detection: ${res.status}`);
  return startDetectShortcutsResponseSchema.parse(await res.json()).jobId;
}

async function fetchDetectShortcutsJob(jobId: number): Promise<DetectShortcutsJob> {
  const res = await fetch(`/api/bookmarks/detect-shortcuts/${jobId}`);
  if (!res.ok) throw new Error(`Failed to load detection job: ${res.status}`);
  return detectShortcutsJobSchema.parse(await res.json());
}

async function clearShortcutCache(): Promise<number> {
  const res = await fetch("/api/bookmarks/clear-shortcut-cache", { method: "POST" });
  if (!res.ok) throw new Error(`Failed to clear shortcut cache: ${res.status}`);
  return clearShortcutCacheResponseSchema.parse(await res.json()).cleared;
}

async function confirmShortcuts(ids: number[]): Promise<void> {
  const res = await fetch("/api/bookmarks/confirm-shortcuts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`Failed to confirm shortcuts: ${res.status}`);
}

async function startSuggestCategories(scope: SuggestCategoriesScope): Promise<number> {
  const res = await fetch("/api/bookmarks/suggest-categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope }),
  });
  if (!res.ok) throw new Error(`Failed to start category suggestion: ${res.status}`);
  return startSuggestCategoriesResponseSchema.parse(await res.json()).jobId;
}

async function fetchCategorySuggestionJob(jobId: number): Promise<CategorySuggestionJob> {
  const res = await fetch(`/api/bookmarks/suggest-categories/${jobId}`);
  if (!res.ok) throw new Error(`Failed to load suggestion job: ${res.status}`);
  return categorySuggestionJobSchema.parse(await res.json());
}

async function applyCategories(assignments: { id: number; category: string }[]): Promise<void> {
  const res = await fetch("/api/bookmarks/apply-categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignments }),
  });
  if (!res.ok) throw new Error(`Failed to apply categories: ${res.status}`);
}

async function renameCategory(from: string, to: string): Promise<RenameCategoryResponse> {
  const res = await fetch("/api/categories", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  });
  if (!res.ok) throw new Error(`Failed to rename category: ${res.status}`);
  return renameCategoryResponseSchema.parse(await res.json());
}

async function suggestTitle(title: string, content: string): Promise<string> {
  const res = await fetch("/api/bookmarks/suggest-title", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, content }),
  });
  if (!res.ok) throw new Error(`Failed to suggest title: ${res.status}`);
  return suggestTitleResponseSchema.parse(await res.json()).title;
}

async function deleteCategory(name: string): Promise<void> {
  const res = await fetch("/api/categories", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to delete category: ${res.status}`);
}

async function createProject(name: string): Promise<void> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to create project: ${res.status}`);
}

async function renameProject(from: string, to: string): Promise<RenameProjectResponse> {
  const res = await fetch("/api/projects", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  });
  if (!res.ok) throw new Error(`Failed to rename project: ${res.status}`);
  return renameProjectResponseSchema.parse(await res.json());
}

async function deleteProject(name: string): Promise<void> {
  const res = await fetch("/api/projects", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to delete project: ${res.status}`);
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

export function useStartDetectShortcuts() {
  return useMutation({ mutationFn: startDetectShortcuts });
}

export function useDetectShortcutsJob(jobId: number | null) {
  return useQuery({
    queryKey: ["detectShortcutsJob", jobId],
    queryFn: () => fetchDetectShortcutsJob(jobId!),
    enabled: jobId !== null,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2000 : false),
  });
}

export function useClearShortcutCache() {
  return useMutation({ mutationFn: clearShortcutCache });
}

export function useConfirmShortcuts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: confirmShortcuts,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bookmarksKey }),
  });
}

export function useStartSuggestCategories() {
  return useMutation({ mutationFn: startSuggestCategories });
}

export function useCategorySuggestionJob(jobId: number | null) {
  return useQuery({
    queryKey: ["categorySuggestionJob", jobId],
    queryFn: () => fetchCategorySuggestionJob(jobId!),
    enabled: jobId !== null,
    // Stops polling once the job leaves "running" — completed/failed results don't change.
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2000 : false),
  });
}

export function useApplyCategories() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: applyCategories,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bookmarksKey });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}

export function useRenameCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => renameCategory(from, to),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bookmarksKey });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bookmarksKey });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}

export function useSuggestTitle() {
  return useMutation({
    mutationFn: ({ title, content }: { title: string; content: string }) => suggestTitle(title, content),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useRenameProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => renameProject(from, to),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bookmarksKey });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bookmarksKey });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
