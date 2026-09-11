import { z } from "zod";

// "resolved" means the user is done deciding what this bookmark is — not "has tags." A
// resolved bookmark can have zero tags (the user judged it needs none); tags/summary presence
// is a convenience trigger for resolving, never the definition of it.
export const bookmarkStatusSchema = z.enum(["pending", "resolved", "failed"]);
export type BookmarkStatus = z.infer<typeof bookmarkStatusSchema>;

// "reference" has real content worth reading/tagging; "shortcut" is a pure entrance/portal
// page (a homepage, a tool's landing page) that's just a launcher, with nothing to summarize.
export const bookmarkTypeSchema = z.enum(["reference", "shortcut"]);
export type BookmarkType = z.infer<typeof bookmarkTypeSchema>;

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
  type: bookmarkTypeSchema,
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
  // flow) — the bookmark is saved as "resolved" immediately instead of resolved asynchronously.
  tags: z.array(z.string()).optional(),
  summary: z.string().optional(),
});
export type CreateBookmarkRequest = z.infer<typeof createBookmarkRequestSchema>;

// POST /bookmarks on a URL that already exists merges instead of duplicating: fields the
// existing row doesn't have yet are filled in silently, but a field both sides disagree on
// (existing has a value, the new save has a different one) is reported here instead of picked
// automatically — the caller decides, then resolves via PATCH /bookmarks/:id.
export const bookmarkConflictFieldSchema = z.enum(["category", "project", "summary", "tags"]);
export type BookmarkConflictField = z.infer<typeof bookmarkConflictFieldSchema>;

export const bookmarkConflictSchema = z.object({
  field: bookmarkConflictFieldSchema,
  existingValue: z.union([z.string(), z.array(z.string())]),
  newValue: z.union([z.string(), z.array(z.string())]),
});
export type BookmarkConflict = z.infer<typeof bookmarkConflictSchema>;

export const createBookmarkConflictResponseSchema = z.object({
  error: z.literal("conflict"),
  bookmarkId: z.number(),
  conflicts: z.array(bookmarkConflictSchema),
});
export type CreateBookmarkConflictResponse = z.infer<typeof createBookmarkConflictResponseSchema>;

export const listBookmarksResponseSchema = z.object({
  bookmarks: z.array(bookmarkSchema),
});
export type ListBookmarksResponse = z.infer<typeof listBookmarksResponseSchema>;

// All fields optional (partial update). For category/project: omitted = leave as-is, ""
// clears it, non-empty sets/creates it. For tags: presence means "replace the full set."
export const updateBookmarkRequestSchema = z.object({
  title: z.string().min(1).optional(),
  summary: z.string().optional(),
  category: z.string().optional(),
  project: z.string().optional(),
  tags: z.array(z.string()).optional(),
  // Manual override/undo for the bulk detect-shortcuts flow below.
  type: bookmarkTypeSchema.optional(),
  // Explicit "I'm done with this one" — the only way to resolve a bookmark that doesn't need
  // tags or a summary at all. Adding tags/a summary still resolves it too, as a convenience.
  resolved: z.boolean().optional(),
});
export type UpdateBookmarkRequest = z.infer<typeof updateBookmarkRequestSchema>;

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

// Bulk import (e.g. from a browser's native bookmarks): each bookmark ends up "tagged" (fetched
// and auto-tagged successfully), "pending" (URL is alive but content couldn't be scraped/tagged
// — same status as a normal untagged save), "invalid" (URL unreachable, not saved), or
// "duplicate" (URL already exists, not re-saved).
export const importOutcomeSchema = z.enum(["tagged", "pending", "invalid", "duplicate"]);
export type ImportOutcome = z.infer<typeof importOutcomeSchema>;

export const importResultItemSchema = z.object({
  url: z.string(),
  title: z.string(),
  outcome: importOutcomeSchema,
  reason: z.string().nullable(),
});
export type ImportResultItem = z.infer<typeof importResultItemSchema>;

export const startImportRequestSchema = z.object({
  bookmarks: z.array(z.object({ url: z.string().url(), title: z.string() })).min(1),
});
export type StartImportRequest = z.infer<typeof startImportRequestSchema>;

export const startImportResponseSchema = z.object({
  jobId: z.number(),
});
export type StartImportResponse = z.infer<typeof startImportResponseSchema>;

export const importJobStatusSchema = z.enum(["running", "completed"]);

export const importJobSchema = z.object({
  id: z.number(),
  status: importJobStatusSchema,
  total: z.number(),
  processed: z.number(),
  results: z.array(importResultItemSchema),
});
export type ImportJob = z.infer<typeof importJobSchema>;

// Detect-then-confirm shortcut classification: scans existing "reference" bookmarks and
// proposes candidates for the user to review, rather than reclassifying anything outright.
export const shortcutCandidateSchema = z.object({
  id: z.number(),
  url: z.string(),
  title: z.string(),
  favicon: z.string().nullable(),
  reason: z.string(),
});
export type ShortcutCandidate = z.infer<typeof shortcutCandidateSchema>;

export const detectShortcutsResponseSchema = z.object({
  candidates: z.array(shortcutCandidateSchema),
});
export type DetectShortcutsResponse = z.infer<typeof detectShortcutsResponseSchema>;

export const confirmShortcutsRequestSchema = z.object({
  ids: z.array(z.number()).min(1),
});
export type ConfirmShortcutsRequest = z.infer<typeof confirmShortcutsRequestSchema>;
