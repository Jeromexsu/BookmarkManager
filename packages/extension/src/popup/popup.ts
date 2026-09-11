import browser from "webextension-polyfill";

const saveBtn = document.getElementById("save") as HTMLButtonElement;
const status = document.getElementById("status")!;
const optionsLink = document.getElementById("options")!;

optionsLink.addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});

saveBtn.addEventListener("click", async () => {
  saveBtn.disabled = true;
  status.textContent = "Saving…";

  const result = (await browser.runtime.sendMessage({ type: "SAVE_CURRENT_TAB" })) as
    | { ok: true }
    | { ok: false; error: string }
    | undefined;

  status.textContent = result?.ok
    ? "Saved! Tags will appear shortly in your Bookmark Manager."
    : result?.error ?? "Something went wrong.";

  saveBtn.disabled = false;
});
