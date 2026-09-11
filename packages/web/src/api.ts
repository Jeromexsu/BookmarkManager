import {
  type Bookmark,
  type CreateBookmarkRequest,
  listBookmarksResponseSchema,
  bookmarkSchema,
} from "@bookmark-manager/shared";

export async function listBookmarks(): Promise<Bookmark[]> {
  const res = await fetch("/api/bookmarks");
  if (!res.ok) throw new Error(`Failed to load bookmarks: ${res.status}`);
  const data = listBookmarksResponseSchema.parse(await res.json());
  return data.bookmarks;
}

export async function createBookmark(input: CreateBookmarkRequest): Promise<Bookmark> {
  const res = await fetch("/api/bookmarks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to create bookmark: ${res.status}`);
  return bookmarkSchema.parse(await res.json());
}
