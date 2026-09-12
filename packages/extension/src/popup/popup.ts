import browser from "webextension-polyfill";
import { BUILD_TIME } from "../generated/buildTime.js";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

interface BookmarkConflict {
  field: "category" | "project" | "summary" | "tags";
  existingValue: string | string[];
  newValue: string | string[];
}

type SaveOutcome =
  | { status: "saved" }
  | { status: "conflict"; bookmarkId: number; conflicts: BookmarkConflict[] }
  | { status: "error"; error: string };

const buildTimeEl = document.getElementById("buildTime")!;
buildTimeEl.textContent = BUILD_TIME === "unbuilt" ? "unbuilt" : `built ${new Date(BUILD_TIME).toLocaleTimeString()}`;

const faviconImg = document.getElementById("favicon") as HTMLImageElement;
const titleInput = document.getElementById("title") as HTMLInputElement;
const urlInput = document.getElementById("url") as HTMLInputElement;
const contentInput = document.getElementById("content") as HTMLTextAreaElement;
const categoryInput = document.getElementById("categoryInput") as HTMLSelectElement;
const projectInput = document.getElementById("projectInput") as HTMLSelectElement;
const tagsContainer = document.getElementById("tagsContainer") as HTMLDivElement;
const tagInput = document.getElementById("tagInput") as HTMLInputElement;
const summaryInput = document.getElementById("summary") as HTMLTextAreaElement;
const typeReferenceBtn = document.getElementById("typeReference") as HTMLButtonElement;
const typeShortcutBtn = document.getElementById("typeShortcut") as HTMLButtonElement;
const autoFillBtn = document.getElementById("autoFill") as HTMLButtonElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const optionsLink = document.getElementById("options")!;
const manageBtn = document.getElementById("manage") as HTMLButtonElement;
const status = document.getElementById("status")!;

const tabSaveBtn = document.getElementById("tabSave") as HTMLButtonElement;
const tabBrowseBtn = document.getElementById("tabBrowse") as HTMLButtonElement;
const saveView = document.getElementById("saveView") as HTMLDivElement;
const browseView = document.getElementById("browseView") as HTMLDivElement;
const searchInput = document.getElementById("searchInput") as HTMLInputElement;
const bookmarkTree = document.getElementById("bookmarkTree") as HTMLDivElement;
const browseEmpty = document.getElementById("browseEmpty") as HTMLParagraphElement;
const groupByCategoryBtn = document.getElementById("groupByCategory") as HTMLButtonElement;
const groupByProjectBtn = document.getElementById("groupByProject") as HTMLButtonElement;

const conflictView = document.getElementById("conflictView") as HTMLDivElement;
const conflictList = document.getElementById("conflictList") as HTMLDivElement;
const conflictApplyBtn = document.getElementById("conflictApply") as HTMLButtonElement;
const conflictCancelBtn = document.getElementById("conflictCancel") as HTMLButtonElement;

const allFields = [titleInput, urlInput, contentInput, categoryInput, projectInput, tagInput, summaryInput];

let tags: string[] = [];
let favicon: string | null = null;
let categoryNames: string[] = [];
let projectNames: string[] = [];
let currentType: "reference" | "shortcut" = "reference";

interface BookmarkSummary {
  id: number;
  url: string;
  title: string;
  favicon: string | null;
  category: string | null;
  project: string | null;
  tags: string[];
}

let allBookmarks: BookmarkSummary[] | null = null;
type GroupMode = "category" | "project";
let groupMode: GroupMode = "category";
const expandedGroups = new Set<string>();

function renderTags() {
  tagsContainer.querySelectorAll(".pill").forEach((el) => el.remove());
  for (const [index, tag] of tags.entries()) {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = tag;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `Remove tag ${tag}`);
    removeBtn.addEventListener("click", () => {
      tags.splice(index, 1);
      renderTags();
    });

    pill.appendChild(removeBtn);
    tagsContainer.insertBefore(pill, tagInput);
  }
}

function addTagFromInput() {
  const value = tagInput.value.trim();
  if (value && !tags.includes(value)) {
    tags.push(value);
    renderTags();
  }
  tagInput.value = "";
}

tagInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    addTagFromInput();
  } else if (e.key === "Backspace" && tagInput.value === "" && tags.length > 0) {
    tags.pop();
    renderTags();
  }
});
tagInput.addEventListener("blur", addTagFromInput);
tagsContainer.addEventListener("click", (e) => {
  if (e.target === tagsContainer) tagInput.focus();
});

// Category and Project are pick-from-the-existing-list only — no typing a new one into
// existence here. Categories are defined in Settings (see SettingsView in the web app); a
// project comes into being by creating it there too. The select keeps its first "No
// category"/"No project" placeholder option and everything else gets replaced on each refresh.
function populateSelect(select: HTMLSelectElement, options: string[]) {
  const previousValue = select.value;
  const placeholder = select.options[0];
  select.innerHTML = "";
  select.appendChild(placeholder);
  for (const opt of options) {
    const option = document.createElement("option");
    option.value = opt;
    option.textContent = opt;
    select.appendChild(option);
  }
  if (options.includes(previousValue)) select.value = previousValue;
}

function setType(type: "reference" | "shortcut") {
  currentType = type;
  typeReferenceBtn.classList.toggle("active", type === "reference");
  typeShortcutBtn.classList.toggle("active", type === "shortcut");
}
typeReferenceBtn.addEventListener("click", () => setType("reference"));
typeShortcutBtn.addEventListener("click", () => setType("shortcut"));

function autoResizeTextarea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}
summaryInput.addEventListener("input", () => autoResizeTextarea(summaryInput));

function setStatus(text: string, kind: "info" | "error" | "success" = "info") {
  status.textContent = text;
  status.className = kind;
}

function setBusy(busy: boolean) {
  for (const field of allFields) field.disabled = busy;
  autoFillBtn.disabled = busy;
  typeReferenceBtn.disabled = busy;
  typeShortcutBtn.disabled = busy;
  saveBtn.disabled = busy;
}

function setFavicon(url: string | null) {
  favicon = url;
  if (url) {
    faviconImg.src = url;
    faviconImg.classList.add("visible");
  } else {
    faviconImg.classList.remove("visible");
  }
}
faviconImg.addEventListener("error", () => faviconImg.classList.remove("visible"));

optionsLink.addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});

manageBtn.addEventListener("click", async () => {
  const result = (await browser.runtime.sendMessage({ type: "OPEN_MANAGE_PAGE" })) as Result<void> | undefined;
  if (!result?.ok) {
    setStatus(result?.error ?? "Couldn't open the manage page.", "error");
    return;
  }
  window.close();
});

function makeChip(text: string, kind: "tag" | "category" | "project"): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = `bm-chip ${kind}`;
  chip.textContent = text;
  return chip;
}

function renderBookmarkRow(bm: BookmarkSummary, opts: { hideCategory: boolean; hideProject: boolean }): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "bm-item";
  row.addEventListener("click", () => browser.tabs.create({ url: bm.url }));

  if (bm.favicon) {
    const icon = document.createElement("img");
    icon.className = "bm-favicon";
    icon.src = bm.favicon;
    icon.alt = "";
    icon.addEventListener("error", () => icon.remove());
    row.appendChild(icon);
  }

  const body = document.createElement("div");
  body.className = "bm-body";

  const title = document.createElement("div");
  title.className = "bm-title";
  title.textContent = bm.title;
  body.appendChild(title);

  const url = document.createElement("div");
  url.className = "bm-url";
  url.textContent = bm.url;
  body.appendChild(url);

  const meta = document.createElement("div");
  meta.className = "bm-meta";
  if (bm.category && !opts.hideCategory) meta.appendChild(makeChip(`📁 ${bm.category}`, "category"));
  if (bm.project && !opts.hideProject) meta.appendChild(makeChip(`📦 ${bm.project}`, "project"));
  for (const tag of bm.tags) meta.appendChild(makeChip(tag, "tag"));
  if (meta.children.length > 0) body.appendChild(meta);

  row.appendChild(body);
  return row;
}

// Groups by category (all bookmarks, "Uncategorized" bucket for those without one) or by
// project (only bookmarks that have one — no catch-all bucket, per the "see projects" ask).
function buildGroups(items: BookmarkSummary[]): Map<string, BookmarkSummary[]> {
  const groups = new Map<string, BookmarkSummary[]>();
  const relevant = groupMode === "project" ? items.filter((bm) => bm.project) : items;

  for (const bm of relevant) {
    const key = groupMode === "project" ? bm.project! : (bm.category ?? "Uncategorized");
    const list = groups.get(key) ?? [];
    list.push(bm);
    groups.set(key, list);
  }
  return groups;
}

function renderTree(items: BookmarkSummary[]) {
  bookmarkTree.innerHTML = "";
  const groups = buildGroups(items);
  const isSearching = searchInput.value.trim() !== "";

  const sortedKeys = [...groups.keys()].sort((a, b) => {
    if (a === "Uncategorized") return 1;
    if (b === "Uncategorized") return -1;
    return a.localeCompare(b);
  });

  browseEmpty.hidden = sortedKeys.length > 0;

  for (const key of sortedKeys) {
    const bookmarksInGroup = groups.get(key)!;
    const folder = document.createElement("div");

    const header = document.createElement("div");
    header.className = "group-header";

    const isExpanded = isSearching || expandedGroups.has(key);
    const chevron = document.createElement("span");
    chevron.className = "group-chevron" + (isExpanded ? " expanded" : "");
    chevron.textContent = "▸";
    header.appendChild(chevron);

    const icon = groupMode === "project" ? "📦" : "📁";
    const label = document.createElement("span");
    label.textContent = `${icon} ${key}`;
    header.appendChild(label);

    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = String(bookmarksInGroup.length);
    header.appendChild(count);

    const children = document.createElement("div");
    children.className = "group-children";
    children.hidden = !isExpanded;
    for (const bm of bookmarksInGroup) {
      children.appendChild(
        renderBookmarkRow(bm, { hideCategory: groupMode === "category", hideProject: groupMode === "project" })
      );
    }

    header.addEventListener("click", () => {
      const nowExpanded = children.hidden;
      children.hidden = !nowExpanded;
      chevron.classList.toggle("expanded", nowExpanded);
      if (nowExpanded) expandedGroups.add(key);
      else expandedGroups.delete(key);
    });

    folder.appendChild(header);
    folder.appendChild(children);
    bookmarkTree.appendChild(folder);
  }
}

function setGroupMode(mode: GroupMode) {
  groupMode = mode;
  groupByCategoryBtn.classList.toggle("active", mode === "category");
  groupByProjectBtn.classList.toggle("active", mode === "project");
  applySearch();
}
groupByCategoryBtn.addEventListener("click", () => setGroupMode("category"));
groupByProjectBtn.addEventListener("click", () => setGroupMode("project"));

function applySearch() {
  if (!allBookmarks) return;
  const query = searchInput.value.trim().toLowerCase();
  const filtered = query
    ? allBookmarks.filter((bm) =>
        [bm.title, bm.url, bm.category, bm.project, ...bm.tags]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(query))
      )
    : allBookmarks;
  renderTree(filtered);
}
searchInput.addEventListener("input", applySearch);

async function loadBookmarks() {
  bookmarkTree.innerHTML = "";
  browseEmpty.hidden = true;
  setStatus("Loading bookmarks…");

  const result = (await browser.runtime.sendMessage({ type: "LIST_BOOKMARKS" })) as
    | Result<BookmarkSummary[]>
    | undefined;

  if (!result?.ok) {
    setStatus(result?.error ?? "Couldn't load bookmarks.", "error");
    return;
  }

  allBookmarks = result.data;
  setStatus("");
  applySearch();
}

function switchTab(tab: "save" | "browse") {
  const showSave = tab === "save";
  saveView.hidden = !showSave;
  browseView.hidden = showSave;
  tabSaveBtn.classList.toggle("active", showSave);
  tabBrowseBtn.classList.toggle("active", !showSave);
  setStatus("");

  if (!showSave && allBookmarks === null) {
    loadBookmarks();
  }
}
tabSaveBtn.addEventListener("click", () => switchTab("save"));
tabBrowseBtn.addEventListener("click", () => switchTab("browse"));

async function init() {
  setBusy(true);
  setStatus("Reading page…");

  const [pageResult, categoriesResult, projectsResult] = await Promise.all([
    browser.runtime.sendMessage({ type: "EXTRACT_CURRENT_TAB" }) as Promise<
      Result<{ url: string; title: string; content: string; favicon: string | null }> | undefined
    >,
    browser.runtime.sendMessage({ type: "LIST_CATEGORIES" }) as Promise<Result<string[]> | undefined>,
    browser.runtime.sendMessage({ type: "LIST_PROJECTS" }) as Promise<Result<string[]> | undefined>,
  ]);

  setBusy(false);

  if (categoriesResult?.ok) {
    categoryNames = categoriesResult.data;
    populateSelect(categoryInput, categoryNames);
  }
  if (projectsResult?.ok) {
    projectNames = projectsResult.data;
    populateSelect(projectInput, projectNames);
  }

  if (!pageResult?.ok) {
    setStatus(pageResult?.error ?? "Couldn't read the current page.", "error");
    return;
  }

  titleInput.value = pageResult.data.title;
  urlInput.value = pageResult.data.url;
  contentInput.value = pageResult.data.content;
  setFavicon(pageResult.data.favicon);
  setStatus("");
}

autoFillBtn.addEventListener("click", async () => {
  setBusy(true);
  setStatus("Auto-filling…");

  const result = (await browser.runtime.sendMessage({
    type: "AUTO_FILL",
    payload: { url: urlInput.value, title: titleInput.value, content: contentInput.value },
  })) as Result<{ tags: string[]; summary: string; category: string | null; isShortcut: boolean }> | undefined;

  setBusy(false);

  if (!result?.ok) {
    setStatus(result?.error ?? "Couldn't auto-fill.", "error");
    return;
  }

  tags = [...result.data.tags];
  renderTags();
  summaryInput.value = result.data.summary;
  autoResizeTextarea(summaryInput);
  if (result.data.category && categoryNames.includes(result.data.category)) {
    categoryInput.value = result.data.category;
  }
  setType(result.data.isShortcut ? "shortcut" : "reference");
  setStatus("Filled in — review before saving.", "success");
});

let pendingConflictBookmarkId: number | null = null;
let currentConflicts: BookmarkConflict[] = [];
let conflictChoices = new Map<string, "existing" | "new">();

const conflictFieldLabels: Record<BookmarkConflict["field"], string> = {
  category: "Category",
  project: "Project",
  summary: "Summary",
  tags: "Tags",
};

function formatConflictValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(", ") : value;
}

function renderConflicts() {
  conflictList.innerHTML = "";
  for (const conflict of currentConflicts) {
    const row = document.createElement("div");
    row.className = "conflict-row";

    const label = document.createElement("div");
    label.className = "conflict-label";
    label.textContent = conflictFieldLabels[conflict.field];
    row.appendChild(label);

    const options = document.createElement("div");
    options.className = "conflict-options";

    const existingBtn = document.createElement("button");
    existingBtn.type = "button";
    existingBtn.className = "conflict-option";
    existingBtn.textContent = `Keep: ${formatConflictValue(conflict.existingValue)}`;

    const newBtn = document.createElement("button");
    newBtn.type = "button";
    newBtn.className = "conflict-option";
    newBtn.textContent = `Use new: ${formatConflictValue(conflict.newValue)}`;

    function refreshSelected() {
      const choice = conflictChoices.get(conflict.field);
      existingBtn.classList.toggle("selected", choice === "existing");
      newBtn.classList.toggle("selected", choice === "new");
    }

    existingBtn.addEventListener("click", () => {
      conflictChoices.set(conflict.field, "existing");
      refreshSelected();
    });
    newBtn.addEventListener("click", () => {
      conflictChoices.set(conflict.field, "new");
      refreshSelected();
    });

    refreshSelected();
    options.appendChild(existingBtn);
    options.appendChild(newBtn);
    row.appendChild(options);
    conflictList.appendChild(row);
  }
}

function showConflicts(bookmarkId: number, conflicts: BookmarkConflict[]) {
  pendingConflictBookmarkId = bookmarkId;
  currentConflicts = conflicts;
  // Default every field to "keep existing" until the user actively picks the new value.
  conflictChoices = new Map(conflicts.map((c) => [c.field, "existing"]));
  renderConflicts();
  conflictView.hidden = false;
}

function hideConflicts() {
  conflictView.hidden = true;
  pendingConflictBookmarkId = null;
  currentConflicts = [];
}

conflictCancelBtn.addEventListener("click", () => {
  hideConflicts();
  setStatus("Kept the existing values.", "success");
});

conflictApplyBtn.addEventListener("click", async () => {
  if (pendingConflictBookmarkId === null) return;

  const patch: Record<string, string | string[]> = {};
  for (const conflict of currentConflicts) {
    if (conflictChoices.get(conflict.field) === "new") {
      patch[conflict.field] = conflict.newValue;
    }
  }

  if (Object.keys(patch).length === 0) {
    hideConflicts();
    setStatus("Kept the existing values.", "success");
    return;
  }

  setStatus("Applying your choices…");
  conflictApplyBtn.disabled = true;
  conflictCancelBtn.disabled = true;

  const result = (await browser.runtime.sendMessage({
    type: "RESOLVE_CONFLICT",
    payload: { bookmarkId: pendingConflictBookmarkId, patch },
  })) as Result<void> | undefined;

  conflictApplyBtn.disabled = false;
  conflictCancelBtn.disabled = false;

  if (!result?.ok) {
    setStatus(result?.error ?? "Failed to apply your choices.", "error");
    return;
  }

  hideConflicts();
  allBookmarks = null;
  setStatus("Saved!", "success");
});

saveBtn.addEventListener("click", async () => {
  if (!urlInput.value || !titleInput.value) {
    setStatus("URL and title are required.", "error");
    return;
  }

  addTagFromInput();
  hideConflicts();
  setBusy(true);
  setStatus("Saving…");

  const result = (await browser.runtime.sendMessage({
    type: "SAVE_BOOKMARK",
    payload: {
      url: urlInput.value,
      title: titleInput.value,
      content: contentInput.value,
      favicon,
      tags,
      category: categoryInput.value.trim(),
      project: projectInput.value.trim(),
      summary: summaryInput.value.trim(),
      type: currentType,
    },
  })) as SaveOutcome | undefined;

  setBusy(false);

  if (!result || result.status === "error") {
    setStatus(result?.error ?? "Failed to save.", "error");
    return;
  }

  if (result.status === "conflict") {
    setStatus("This bookmark already exists with different values — pick which to keep below.", "info");
    showConflicts(result.bookmarkId, result.conflicts);
    return;
  }

  allBookmarks = null; // invalidate the Browse tab's cache so it refetches with this new save
  setStatus("Saved!", "success");
});

init();
