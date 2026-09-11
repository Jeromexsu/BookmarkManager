import browser from "webextension-polyfill";

const input = document.getElementById("serverUrl") as HTMLInputElement;
const status = document.getElementById("status")!;

browser.storage.sync.get("serverUrl").then((data) => {
  if (typeof data.serverUrl === "string") input.value = data.serverUrl;
});

document.getElementById("save")!.addEventListener("click", async () => {
  await browser.storage.sync.set({ serverUrl: input.value.trim() });
  status.textContent = "Saved.";
  setTimeout(() => (status.textContent = ""), 1500);
});
