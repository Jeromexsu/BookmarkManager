import browser from "webextension-polyfill";
import { BUILD_TIME } from "./generated/buildTime.js";

document.getElementById("buildTime")!.textContent =
  BUILD_TIME === "unbuilt" ? "unbuilt" : `Build: ${new Date(BUILD_TIME).toLocaleString()}`;

type BookmarkTreeNode = Awaited<ReturnType<typeof browser.bookmarks.getTree>>[number];

interface ImportResultItem {
  url: string;
  title: string;
  outcome: "tagged" | "pending" | "invalid" | "duplicate";
  reason: string | null;
}

interface ImportJob {
  id: number;
  status: "running" | "completed";
  total: number;
  processed: number;
  results: ImportResultItem[];
}

const serverUrlInput = document.getElementById("serverUrl") as HTMLInputElement;
const saveServerBtn = document.getElementById("saveServer") as HTMLButtonElement;
const serverStatus = document.getElementById("serverStatus")!;

const downloadBackupBtn = document.getElementById("downloadBackup") as HTMLButtonElement;
const syncBtn = document.getElementById("syncToBrowser") as HTMLButtonElement;
const syncStatusEl = document.getElementById("syncStatus")!;

const startImportBtn = document.getElementById("startImport") as HTMLButtonElement;
const importProgress = document.getElementById("importProgress") as HTMLDivElement;
const progressFill = document.getElementById("progressFill") as HTMLDivElement;
const progressText = document.getElementById("progressText") as HTMLParagraphElement;
const importSummary = document.getElementById("importSummary") as HTMLDivElement;
const summaryText = document.getElementById("summaryText") as HTMLParagraphElement;
const summaryCounts = document.getElementById("summaryCounts") as HTMLDivElement;
const downloadReportBtn = document.getElementById("downloadReport") as HTMLButtonElement;

let lastResults: ImportResultItem[] = [];

async function getServerUrl(): Promise<string | null> {
  const { serverUrl } = await browser.storage.sync.get("serverUrl");
  return typeof serverUrl === "string" && serverUrl ? serverUrl : null;
}

browser.storage.sync.get("serverUrl").then((data) => {
  if (typeof data.serverUrl === "string") serverUrlInput.value = data.serverUrl;
});

saveServerBtn.addEventListener("click", async () => {
  await browser.storage.sync.set({ serverUrl: serverUrlInput.value.trim() });
  serverStatus.textContent = "Saved.";
  serverStatus.classList.add("success");
  setTimeout(() => {
    serverStatus.textContent = "";
    serverStatus.classList.remove("success");
  }, 1500);
});

function flattenBookmarks(nodes: BookmarkTreeNode[]): { url: string; title: string }[] {
  const out: { url: string; title: string }[] = [];
  for (const node of nodes) {
    if (node.url) {
      out.push({ url: node.url, title: node.title || node.url });
    }
    if (node.children) {
      out.push(...flattenBookmarks(node.children));
    }
  }
  return out;
}

async function pollImport(serverUrl: string, jobId: number) {
  const MAX_CONSECUTIVE_FAILURES = 5;
  let consecutiveFailures = 0;

  for (;;) {
    let job: ImportJob;
    try {
      const res = await fetch(`${serverUrl.replace(/\/$/, "")}/api/import/${jobId}`);
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      job = (await res.json()) as ImportJob;
      consecutiveFailures = 0;
    } catch (err) {
      // A transient hiccup (e.g. the server restarting) must not silently kill polling —
      // that leaves the page stuck showing a progress bar forever with no way to recover.
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        progressText.textContent = `Lost track of the import job: ${err instanceof Error ? err.message : "unknown error"}.`;
        return;
      }
      progressText.textContent = "Reconnecting…";
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }

    const pct = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 100;
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `${job.processed} / ${job.total} processed…`;

    if (job.status === "completed") {
      lastResults = job.results;
      showSummary(job.results);
      importProgress.hidden = true;
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
}

function showSummary(results: ImportResultItem[]) {
  const counts = { tagged: 0, pending: 0, invalid: 0, duplicate: 0 };
  for (const r of results) counts[r.outcome]++;

  summaryText.textContent = `Imported ${results.length} bookmarks from your browser.`;
  summaryCounts.innerHTML = "";
  const labels: [keyof typeof counts, string][] = [
    ["tagged", "Tagged"],
    ["pending", "Pending (untagged)"],
    ["invalid", "Invalid (skipped)"],
    ["duplicate", "Duplicate (skipped)"],
  ];
  for (const [key, label] of labels) {
    const el = document.createElement("div");
    el.className = "summary-count";
    el.innerHTML = `<b>${counts[key]}</b>${label}`;
    summaryCounts.appendChild(el);
  }
  importSummary.hidden = false;
}

startImportBtn.addEventListener("click", async () => {
  const serverUrl = await getServerUrl();
  if (!serverUrl) {
    alert("Set your server URL above first.");
    return;
  }

  startImportBtn.disabled = true;
  importSummary.hidden = true;
  importProgress.hidden = false;
  progressFill.style.width = "0%";
  progressText.textContent = "Reading browser bookmarks…";

  try {
    const tree = await browser.bookmarks.getTree();
    const items = flattenBookmarks(tree);

    if (items.length === 0) {
      progressText.textContent = "No bookmarks found in this browser.";
      importProgress.hidden = true;
      return;
    }

    progressText.textContent = `Starting import of ${items.length} bookmarks…`;

    const startRes = await fetch(`${serverUrl.replace(/\/$/, "")}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookmarks: items }),
    });

    if (!startRes.ok) {
      progressText.textContent = `Failed to start import (server responded ${startRes.status}).`;
      return;
    }

    const { jobId } = (await startRes.json()) as { jobId: number };
    await pollImport(serverUrl, jobId);
  } finally {
    startImportBtn.disabled = false;
  }
});

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

downloadReportBtn.addEventListener("click", () => {
  const header = "url,title,outcome,reason\n";
  const rows = lastResults
    .map((r) => [r.url, r.title, r.outcome, r.reason ?? ""].map(csvEscape).join(","))
    .join("\n");
  const blob = new Blob([header + rows], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "bookmark-import-report.csv";
  a.click();
  URL.revokeObjectURL(url);
});

// --- Sync to browser ---
//
// Mirrors resolved bookmarks into this browser's native Bookmarks Toolbar (shortcuts) and
// Other Bookmarks (references), organized into per-category subfolders. One-way only —
// app to browser, never the reverse — and additive with a soft-delete tombstone: the server
// never hard-deletes a bookmark, it flips `invalid` and bumps `updatedAt` (see schema.ts), so
// a plain "give me everything changed since X" diff is enough to notice removals too, with no
// need to keep a full ledger of everything ever synced. Only a single last-synced timestamp is
// kept locally (in storage.local — deliberately NOT storage.sync, since a bookmark id from one
// browser install has no meaning in another, so each install must track its own sync state).

interface SyncBookmark {
  id: number;
  url: string;
  title: string;
  category: string | null;
  type: "reference" | "shortcut";
  invalid: boolean;
  updatedAt: string;
}

// Firefox's well-known root folder guids — stable across profiles, always present.
const TOOLBAR_ROOT_ID = "toolbar_____";
const OTHER_ROOT_ID = "unfiled_____";
const LAST_SYNC_KEY = "lastBookmarkSyncAt";

function setSyncStatus(text: string, kind: "info" | "error" | "success" = "info") {
  syncStatusEl.textContent = text;
  syncStatusEl.className = kind;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Netscape Bookmark File Format — the one export/import format every browser understands, so
// this backup can be dragged straight back in through Firefox's own "Import Bookmarks from
// HTML" if a sync ever goes wrong. Backs up the WHOLE tree (not just Toolbar/Other), since a
// backup that only covers the two folders about to be wiped isn't a real safety net.
function serializeBookmarksHtml(tree: BookmarkTreeNode[]): string {
  function renderNode(node: BookmarkTreeNode): string {
    const addDate = Math.floor((node.dateAdded ?? Date.now()) / 1000);
    if (node.url) {
      return `<DT><A HREF="${escapeHtml(node.url)}" ADD_DATE="${addDate}">${escapeHtml(node.title || node.url)}</A>\n`;
    }
    const children = (node.children ?? []).map(renderNode).join("");
    return `<DT><H3 ADD_DATE="${addDate}">${escapeHtml(node.title || "Untitled")}</H3>\n<DL><p>\n${children}</DL><p>\n`;
  }

  const topLevel = tree.flatMap((n) => n.children ?? []).map(renderNode).join("");
  return (
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>\n" +
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n' +
    "<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n" +
    `<DL><p>\n${topLevel}</DL><p>\n`
  );
}

downloadBackupBtn.addEventListener("click", async () => {
  downloadBackupBtn.disabled = true;
  try {
    const tree = await browser.bookmarks.getTree();
    const blob = new Blob([serializeBookmarksHtml(tree)], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bookmarks-backup-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    downloadBackupBtn.disabled = false;
  }
});

// One pass over both managed roots, building lookups by URL (existing bookmark nodes) and by
// "root:folder name" (existing category folders) — cheaper than a `bookmarks.search()` round
// trip per item, and avoids ever touching anything outside these two roots.
async function buildBrowserIndex(): Promise<{ urlIndex: Map<string, BookmarkTreeNode>; folderIndex: Map<string, string> }> {
  const urlIndex = new Map<string, BookmarkTreeNode>();
  const folderIndex = new Map<string, string>();

  function walk(node: BookmarkTreeNode, rootId: string) {
    for (const child of node.children ?? []) {
      if (child.url) {
        urlIndex.set(child.url, child);
      } else {
        folderIndex.set(`${rootId}:${child.title}`, child.id);
        walk(child, rootId);
      }
    }
  }

  for (const rootId of [TOOLBAR_ROOT_ID, OTHER_ROOT_ID]) {
    const [rootNode] = await browser.bookmarks.getSubTree(rootId);
    walk(rootNode, rootId);
  }

  return { urlIndex, folderIndex };
}

async function getOrCreateFolder(rootId: string, name: string, folderIndex: Map<string, string>): Promise<string> {
  const key = `${rootId}:${name}`;
  const existing = folderIndex.get(key);
  if (existing) return existing;
  const created = await browser.bookmarks.create({ parentId: rootId, title: name });
  folderIndex.set(key, created.id);
  return created.id;
}

async function wipeRoot(rootId: string) {
  const [rootNode] = await browser.bookmarks.getSubTree(rootId);
  for (const child of rootNode.children ?? []) {
    await browser.bookmarks.removeTree(child.id);
  }
}

syncBtn.addEventListener("click", async () => {
  const serverUrl = await getServerUrl();
  if (!serverUrl) {
    setSyncStatus("Set your server URL above first.", "error");
    return;
  }

  const stored = await browser.storage.local.get(LAST_SYNC_KEY);
  const since = typeof stored[LAST_SYNC_KEY] === "string" ? (stored[LAST_SYNC_KEY] as string) : null;
  const isFirstSync = since === null;

  if (isFirstSync) {
    const proceed = confirm(
      "First sync: this will permanently replace everything currently in this browser's " +
        "Bookmarks Toolbar and Other Bookmarks with your organized Bookmark Manager library. " +
        "This can't be undone by the extension — download a backup first if you haven't already.\n\n" +
        "Continue?"
    );
    if (!proceed) return;
  }

  syncBtn.disabled = true;
  setSyncStatus("Fetching changes…");

  try {
    const query = since ? `?since=${encodeURIComponent(since)}` : "";
    const res = await fetch(`${serverUrl.replace(/\/$/, "")}/api/bookmarks/sync${query}`);
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const data = (await res.json()) as { bookmarks: SyncBookmark[]; syncedAt: string };

    if (isFirstSync) {
      setSyncStatus("Clearing existing Toolbar/Other Bookmarks…");
      await wipeRoot(TOOLBAR_ROOT_ID);
      await wipeRoot(OTHER_ROOT_ID);
    }

    const { urlIndex, folderIndex } = await buildBrowserIndex();

    let created = 0;
    let updated = 0;
    let removed = 0;

    for (const [index, b] of data.bookmarks.entries()) {
      setSyncStatus(`Syncing… ${index + 1}/${data.bookmarks.length}`);
      const rootId = b.type === "shortcut" ? TOOLBAR_ROOT_ID : OTHER_ROOT_ID;
      const existingNode = urlIndex.get(b.url);

      if (b.invalid) {
        if (existingNode) {
          await browser.bookmarks.remove(existingNode.id);
          urlIndex.delete(b.url);
          removed++;
        }
        continue;
      }

      const parentId = b.category ? await getOrCreateFolder(rootId, b.category, folderIndex) : rootId;

      if (existingNode) {
        if (existingNode.title !== b.title) {
          await browser.bookmarks.update(existingNode.id, { title: b.title });
        }
        if (existingNode.parentId !== parentId) {
          await browser.bookmarks.move(existingNode.id, { parentId });
        }
        updated++;
      } else {
        const node = await browser.bookmarks.create({ parentId, title: b.title, url: b.url });
        urlIndex.set(b.url, node);
        created++;
      }
    }

    await browser.storage.local.set({ [LAST_SYNC_KEY]: data.syncedAt });
    setSyncStatus(`Synced — ${created} added, ${updated} updated, ${removed} removed.`, "success");
  } catch (err) {
    setSyncStatus(`Sync failed: ${err instanceof Error ? err.message : "unknown error"}`, "error");
  } finally {
    syncBtn.disabled = false;
  }
});
