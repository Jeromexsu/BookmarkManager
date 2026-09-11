import browser from "webextension-polyfill";

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
  for (;;) {
    const res = await fetch(`${serverUrl.replace(/\/$/, "")}/api/import/${jobId}`);
    if (!res.ok) {
      progressText.textContent = `Lost track of the import job (server responded ${res.status}).`;
      return;
    }
    const job = (await res.json()) as ImportJob;

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
