import browser from "webextension-polyfill";
import { extractPageContent } from "./content.js";

interface ExtractedPage {
  url: string;
  title: string;
  content: string;
  favicon: string | null;
}

interface TagSuggestion {
  tags: string[];
  summary: string;
}

interface BookmarkPayload extends ExtractedPage, TagSuggestion {
  category?: string;
  project?: string;
}

interface BookmarkSummary {
  id: number;
  url: string;
  title: string;
  favicon: string | null;
  category: string | null;
  project: string | null;
  tags: string[];
  status: "pending" | "resolved" | "failed";
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

interface BookmarkConflict {
  field: "category" | "project" | "summary" | "tags";
  existingValue: string | string[];
  newValue: string | string[];
}

// A field both sides already disagree on (mirrors the server's 409 from POST /bookmarks) —
// the popup shows these to the user instead of picking one automatically.
type SaveOutcome =
  | { status: "saved" }
  | { status: "conflict"; bookmarkId: number; conflicts: BookmarkConflict[] }
  | { status: "error"; error: string };

async function getServerUrl(): Promise<string | null> {
  const { serverUrl } = await browser.storage.sync.get("serverUrl");
  return typeof serverUrl === "string" && serverUrl ? serverUrl : null;
}

async function extractCurrentTab(): Promise<Result<ExtractedPage>> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { ok: false, error: "No active tab found." };
  }

  const [injected] = await browser.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPageContent,
  });
  const extracted = injected.result as { url: string; title: string; content: string };
  return { ok: true, data: { ...extracted, favicon: tab.favIconUrl ?? null } };
}

async function previewTags(page: { url: string; title: string; content: string }): Promise<Result<TagSuggestion>> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) {
    return { ok: false, error: "Set your server URL in the extension settings first." };
  }
  if (!page.content.trim()) {
    return { ok: false, error: "No page content to tag." };
  }

  const res = await fetch(`${serverUrl.replace(/\/$/, "")}/api/bookmarks/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(page),
  });
  if (!res.ok) {
    return { ok: false, error: `Server responded with ${res.status}` };
  }
  return { ok: true, data: await res.json() };
}

async function fetchNames(path: "categories" | "projects"): Promise<Result<string[]>> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) {
    return { ok: false, error: "Set your server URL in the extension settings first." };
  }

  const res = await fetch(`${serverUrl.replace(/\/$/, "")}/api/${path}`);
  if (!res.ok) {
    return { ok: false, error: `Server responded with ${res.status}` };
  }
  const data = (await res.json()) as { names: string[] };
  return { ok: true, data: data.names };
}

async function listBookmarks(): Promise<Result<BookmarkSummary[]>> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) {
    return { ok: false, error: "Set your server URL in the extension settings first." };
  }

  const res = await fetch(`${serverUrl.replace(/\/$/, "")}/api/bookmarks`);
  if (!res.ok) {
    return { ok: false, error: `Server responded with ${res.status}` };
  }
  const data = (await res.json()) as { bookmarks: BookmarkSummary[] };
  return { ok: true, data: data.bookmarks };
}

async function saveBookmark(payload: BookmarkPayload): Promise<SaveOutcome> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) {
    return { status: "error", error: "Set your server URL in the extension settings first." };
  }

  const res = await fetch(`${serverUrl.replace(/\/$/, "")}/api/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (res.status === 409) {
    const body = (await res.json()) as { bookmarkId: number; conflicts: BookmarkConflict[] };
    return { status: "conflict", bookmarkId: body.bookmarkId, conflicts: body.conflicts };
  }
  if (!res.ok) {
    return { status: "error", error: `Server responded with ${res.status}` };
  }
  return { status: "saved" };
}

// Applies the user's per-field choice after a save conflict — "use new" fields only, since
// "keep existing" needs no request at all.
async function resolveConflict(bookmarkId: number, patch: Record<string, string | string[]>): Promise<Result<void>> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) {
    return { ok: false, error: "Set your server URL in the extension settings first." };
  }

  const res = await fetch(`${serverUrl.replace(/\/$/, "")}/api/bookmarks/${bookmarkId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    return { ok: false, error: `Server responded with ${res.status}` };
  }
  return { ok: true, data: undefined };
}

type IncomingMessage =
  | { type: "EXTRACT_CURRENT_TAB" }
  | { type: "PREVIEW_TAGS"; payload: { url: string; title: string; content: string } }
  | { type: "LIST_CATEGORIES" }
  | { type: "LIST_PROJECTS" }
  | { type: "LIST_BOOKMARKS" }
  | { type: "SAVE_BOOKMARK"; payload: BookmarkPayload }
  | { type: "RESOLVE_CONFLICT"; payload: { bookmarkId: number; patch: Record<string, string | string[]> } };

browser.runtime.onMessage.addListener((raw: unknown) => {
  const message = raw as IncomingMessage;
  if (message?.type === "EXTRACT_CURRENT_TAB") return extractCurrentTab();
  if (message?.type === "PREVIEW_TAGS") return previewTags(message.payload);
  if (message?.type === "LIST_CATEGORIES") return fetchNames("categories");
  if (message?.type === "LIST_PROJECTS") return fetchNames("projects");
  if (message?.type === "LIST_BOOKMARKS") return listBookmarks();
  if (message?.type === "SAVE_BOOKMARK") return saveBookmark(message.payload);
  if (message?.type === "RESOLVE_CONFLICT") return resolveConflict(message.payload.bookmarkId, message.payload.patch);
});
