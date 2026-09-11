import browser from "webextension-polyfill";
import { BUILD_TIME } from "../generated/buildTime.js";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const buildTimeEl = document.getElementById("buildTime")!;
buildTimeEl.textContent = BUILD_TIME === "unbuilt" ? "unbuilt" : `built ${new Date(BUILD_TIME).toLocaleTimeString()}`;

const faviconImg = document.getElementById("favicon") as HTMLImageElement;
const titleInput = document.getElementById("title") as HTMLInputElement;
const urlInput = document.getElementById("url") as HTMLInputElement;
const contentInput = document.getElementById("content") as HTMLTextAreaElement;
const categoryInput = document.getElementById("categoryInput") as HTMLInputElement;
const categoryMenu = document.getElementById("categoryMenu") as HTMLDivElement;
const projectInput = document.getElementById("projectInput") as HTMLInputElement;
const projectMenu = document.getElementById("projectMenu") as HTMLDivElement;
const tagsContainer = document.getElementById("tagsContainer") as HTMLDivElement;
const tagInput = document.getElementById("tagInput") as HTMLInputElement;
const summaryInput = document.getElementById("summary") as HTMLTextAreaElement;
const autoTagBtn = document.getElementById("autoTag") as HTMLButtonElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const optionsLink = document.getElementById("options")!;
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

const allFields = [titleInput, urlInput, contentInput, categoryInput, projectInput, tagInput, summaryInput];

let tags: string[] = [];
let favicon: string | null = null;
let categoryNames: string[] = [];
let projectNames: string[] = [];

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

// A combobox: click/focus shows all existing options, typing filters them, and typed text
// that matches nothing existing shows a "+ Add" hint — since saving just sends whatever text
// is in the field and the server upserts it by name, "adding" needs no extra confirmation step.
function setupCombobox(input: HTMLInputElement, menu: HTMLDivElement, getOptions: () => string[]) {
  function closeMenu() {
    menu.hidden = true;
  }

  function render() {
    const query = input.value.trim().toLowerCase();
    const options = getOptions();
    const filtered = query ? options.filter((o) => o.toLowerCase().includes(query)) : options;

    menu.innerHTML = "";
    for (const opt of filtered) {
      const item = document.createElement("div");
      item.className = "combobox-item";
      item.textContent = opt;
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = opt;
        closeMenu();
      });
      menu.appendChild(item);
    }

    if (query && !options.some((o) => o.toLowerCase() === query)) {
      const create = document.createElement("div");
      create.className = "combobox-item create";
      create.textContent = `+ Add "${input.value.trim()}"`;
      create.addEventListener("mousedown", (e) => {
        e.preventDefault();
        closeMenu();
      });
      menu.appendChild(create);
    }

    menu.hidden = menu.children.length === 0;
  }

  input.addEventListener("focus", render);
  input.addEventListener("input", render);
  input.addEventListener("blur", () => setTimeout(closeMenu, 100));
}

setupCombobox(categoryInput, categoryMenu, () => categoryNames);
setupCombobox(projectInput, projectMenu, () => projectNames);

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
  autoTagBtn.disabled = busy;
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

  if (categoriesResult?.ok) categoryNames = categoriesResult.data;
  if (projectsResult?.ok) projectNames = projectsResult.data;

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

autoTagBtn.addEventListener("click", async () => {
  setBusy(true);
  setStatus("Generating tags…");

  const result = (await browser.runtime.sendMessage({
    type: "PREVIEW_TAGS",
    payload: { url: urlInput.value, title: titleInput.value, content: contentInput.value },
  })) as Result<{ tags: string[]; summary: string }> | undefined;

  setBusy(false);

  if (!result?.ok) {
    setStatus(result?.error ?? "Couldn't generate tags.", "error");
    return;
  }

  tags = [...result.data.tags];
  renderTags();
  summaryInput.value = result.data.summary;
  autoResizeTextarea(summaryInput);
  setStatus("Tags generated.", "success");
});

saveBtn.addEventListener("click", async () => {
  if (!urlInput.value || !titleInput.value) {
    setStatus("URL and title are required.", "error");
    return;
  }

  addTagFromInput();
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
    },
  })) as Result<void> | undefined;

  setBusy(false);

  if (!result?.ok) {
    setStatus(result?.error ?? "Failed to save.", "error");
    return;
  }

  allBookmarks = null; // invalidate the Browse tab's cache so it refetches with this new save
  setStatus("Saved!", "success");
});

init();
