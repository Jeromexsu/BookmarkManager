import browser from "webextension-polyfill";

interface PreviewData {
  url: string;
  title: string;
  content: string;
  tags: string[];
  category: string;
  summary: string;
  warning?: string;
}

const views = {
  initial: document.getElementById("initial")!,
  loading: document.getElementById("loading")!,
  review: document.getElementById("review")!,
  done: document.getElementById("done")!,
};
function show(view: keyof typeof views) {
  for (const [key, el] of Object.entries(views)) {
    (el as HTMLElement).hidden = key !== view;
  }
}

const saveBtn = document.getElementById("save") as HTMLButtonElement;
const confirmBtn = document.getElementById("confirmSave") as HTMLButtonElement;
const cancelBtn = document.getElementById("cancel") as HTMLButtonElement;
const optionsLink = document.getElementById("options")!;
const status = document.getElementById("status")!;
const reviewTitle = document.getElementById("reviewTitle")!;
const reviewWarning = document.getElementById("reviewWarning")!;
const categoryInput = document.getElementById("category") as HTMLInputElement;
const tagsInput = document.getElementById("tags") as HTMLInputElement;
const summaryEl = document.getElementById("summary")!;
const doneMessage = document.getElementById("doneMessage")!;

let pending: { url: string; title: string; content: string; summary: string } | null = null;

optionsLink.addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});

saveBtn.addEventListener("click", async () => {
  status.textContent = "";
  show("loading");

  const result = (await browser.runtime.sendMessage({ type: "PREVIEW_CURRENT_TAB" })) as
    | { ok: true; data: PreviewData }
    | { ok: false; error: string }
    | undefined;

  if (!result?.ok) {
    show("initial");
    status.textContent = result?.error ?? "Something went wrong.";
    return;
  }

  const { data } = result;
  pending = { url: data.url, title: data.title, content: data.content, summary: data.summary };
  reviewTitle.textContent = data.title;
  reviewWarning.textContent = data.warning ?? "";
  categoryInput.value = data.category;
  tagsInput.value = data.tags.join(", ");
  summaryEl.textContent = data.summary;
  show("review");
});

cancelBtn.addEventListener("click", () => {
  pending = null;
  show("initial");
});

confirmBtn.addEventListener("click", async () => {
  if (!pending) return;
  confirmBtn.disabled = true;

  const tags = tagsInput.value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const result = (await browser.runtime.sendMessage({
    type: "CONFIRM_SAVE",
    payload: { ...pending, tags, category: categoryInput.value.trim() },
  })) as { ok: true } | { ok: false; error: string } | undefined;

  confirmBtn.disabled = false;

  if (result?.ok) {
    doneMessage.textContent = "Saved!";
    show("done");
  } else {
    reviewWarning.textContent = result?.error ?? "Failed to save.";
  }
});
