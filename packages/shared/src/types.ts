import { z } from "zod";

export const bookmarkStatusSchema = z.enum(["pending", "tagged", "failed"]);
export type BookmarkStatus = z.infer<typeof bookmarkStatusSchema>;

export const bookmarkSchema = z.object({
  id: z.number(),
  url: z.string().url(),
  title: z.string(),
  content: z.string().nullable(),
  summary: z.string().nullable(),
  favicon: z.string().nullable(),
  // Broad, user-only grouping (e.g. lifestyle/coding/travel) and a bundle of deep-coupled
  // bookmarks, also user-only — neither is AI-generated. See ai/embeddings.ts-style note:
  // AI-assisted category suggestions are a later "management" feature, not collection-time.
  category: z.string().nullable(),
  project: z.string().nullable(),
  status: bookmarkStatusSchema,
  tags: z.array(z.string()),
  createdAt: z.string(),
});
export type Bookmark = z.infer<typeof bookmarkSchema>;

export const createBookmarkRequestSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  content: z.string().optional(),
  favicon: z.string().optional(),
  category: z.string().optional(),
  project: z.string().optional(),
  // Present when the caller already has confirmed tags (the extension's preview-then-confirm
  // flow) — the bookmark is saved as "tagged" immediately instead of tagged asynchronously.
  tags: z.array(z.string()).optional(),
  summary: z.string().optional(),
});
export type CreateBookmarkRequest = z.infer<typeof createBookmarkRequestSchema>;

export const listBookmarksResponseSchema = z.object({
  bookmarks: z.array(bookmarkSchema),
});
export type ListBookmarksResponse = z.infer<typeof listBookmarksResponseSchema>;

export const previewBookmarkRequestSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  content: z.string().min(1),
});
export type PreviewBookmarkRequest = z.infer<typeof previewBookmarkRequestSchema>;

export const previewBookmarkResponseSchema = z.object({
  tags: z.array(z.string()),
  summary: z.string(),
});
export type PreviewBookmarkResponse = z.infer<typeof previewBookmarkResponseSchema>;

// Shared by GET /api/categories and GET /api/projects — both just list existing names
// so a client can offer "pick existing or type a new one."
export const nameListResponseSchema = z.object({
  names: z.array(z.string()),
});
export type NameListResponse = z.infer<typeof nameListResponseSchema>;
